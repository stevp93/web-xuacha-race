#!/usr/bin/env python3
"""Pruebas de extremo a extremo de XUACHA RACE: sitio, inscripción, pagos simulados y panel.

Requiere, corriendo en local:
  - la API (backend/node/server.ts) en API_URL, con las llaves de env.sh
  - el simulador de Wompi (mock-wompi.mjs) en MOCK_URL
  - el sitio estático en SITE_URL
  - Postgres con la base indicada en DATABASE_URL
Uso: python3 e2e.py [nombre_de_prueba ...]
"""
import json, os, re, subprocess, sys, time, traceback, urllib.request, urllib.error, uuid, random
from playwright.sync_api import sync_playwright

SITE = os.environ.get('SITE_URL', 'http://localhost:8766')
API = os.environ.get('API_URL', 'http://localhost:8787/api')
API_NOGW = os.environ.get('API_NOGW_URL', 'http://localhost:8788/api')
MOCK = os.environ.get('MOCK_URL', 'http://localhost:8799')
DB = os.environ.get('DATABASE_URL', 'postgres://pgtest@localhost:5433/xr_e2e')
ADMIN = os.environ.get('ADMIN_API_KEY', 'admin-e2e-key-0123456789abcdef')
INTERNAL = os.environ.get('INTERNAL_API_KEY', 'internal-e2e-key-0123456789')
SHOTS = os.environ.get('SHOTS', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots'))
os.makedirs(SHOTS, exist_ok=True)

RESULTS = []
FINDINGS = []


def finding(sev, title, detail):
    FINDINGS.append((sev, title, detail))


# ---------- utilidades ----------

def sql(q):
    out = subprocess.run(['psql', '-At', '-F', '\t', DB, '-c', q], capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr)
    return [l.split('\t') for l in out.stdout.strip().splitlines() if l]


def http(method, url, body=None, headers=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {'Content-Type': 'application/json'}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, parse(r.read(), r.headers), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, parse(e.read(), e.headers), dict(e.headers)


def parse(raw, headers):
    if 'json' not in (headers.get('Content-Type') or ''):
        return raw
    txt = raw.decode()
    try:
        return json.loads(txt) if txt else None
    except Exception:
        return txt


def api(method, path, body=None, token=None, base=API, raw=None, headers=None):
    h = dict(headers or {})
    if token:
        h['Authorization'] = 'Bearer ' + token
    return http(method, base + path, body, h, raw)


def admin(method, path, body=None):
    return api(method, path, body, ADMIN)


def new_doc():
    return str(random.randint(10_000_000, 99_999_999))


def person(name=None):
    d = new_doc()
    letters = ''.join('ABCDEFGHIJ'[int(x)] for x in d[-4:]).capitalize()
    return {'full_name': name or f'Prueba {letters}', 'doc_type': 'CC', 'doc_number': d,
            'email': f'e2e{d}@example.com', 'whatsapp': '3' + d + '0'}


def messages_for(doc, template=None):
    q = (f"select o.template, replace(o.body, E'\\n', ' ') from notifications_outbox o join registrations r on r.id = o.registration_id "
         f"join participants p on p.id = r.participant_id where p.doc_number = '{doc}'"
         + (f" and o.template = '{template}'" if template else '') + " order by o.created_at")
    return sql(q)


def otp_for(doc):
    rows = sql(f"select o.body from notifications_outbox o where o.template = 'otp' and o.to_e164 = "
               f"(select whatsapp_e164 from participants where doc_number = '{doc}') order by o.created_at desc limit 1")
    m = re.search(r'\*(\d{6})\*', rows[0][0]) if rows else None
    return m.group(1) if m else None


def link_token(body):
    m = re.search(r'#t=(rt_[\w-]+)', body)
    return m.group(1) if m else None


# ---------- navegador ----------

class Run:
    def __init__(self, pw):
        # El HTML con la política de contenido ajustada lo entrega Playwright; Chrome lo trataría como
        # una página pública que llama a localhost y bloquearía la API local por "Local Network Access".
        self.browser = pw.chromium.launch(args=['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'])

    def context(self, mobile=False, nogw=False):
        if mobile:
            ctx = self.browser.new_context(viewport={'width': 375, 'height': 780}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True)
        else:
            ctx = self.browser.new_context(viewport={'width': 1280, 'height': 860}, accept_downloads=True)
        base = API_NOGW if nogw else API
        cfg = ("window.XR_CONFIG = { apiBase: '%s', fallbackApiBase: '', turnstileSiteKey: '', "
               "siteUrl: '%s', supportWhatsapp: '573239335820' };" % (base, SITE))
        ctx.route('**/assets/js/xr-config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=cfg))
        # La política de contenido de producción solo permite https; aquí la API local es http.
        def local_csp(route):
            res = route.fetch()
            body = res.text().replace("connect-src 'self' https:", "connect-src 'self' https: http://localhost:8787 http://localhost:8788")
            route.fulfill(response=res, body=body)
        ctx.route(re.compile(r'^' + re.escape(SITE) + r'/(inscripcion|resultado|admin)\.html'), local_csp)
        # El Web Checkout real se reemplaza por el simulador, con los mismos parámetros firmados.
        ctx.route('https://checkout.wompi.co/**', lambda r: r.fulfill(status=302, headers={'Location': MOCK + '/p/?' + r.request.url.split('?', 1)[1]}))
        # Analítica y servicios externos fuera de la prueba.
        ctx.route(re.compile(r'https://(www\.googletagmanager\.com|www\.clarity\.ms|.*clarity\.ms)/.*'), lambda r: r.abort())
        ctx.errors = []
        ctx.bad = []
        def on_page(p):
            p.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and ctx.errors.append(m.text))
            p.on('pageerror', lambda e: ctx.errors.append('pageerror: ' + str(e)))
            p.on('response', lambda r: r.status >= 400 and (SITE in r.url) and ctx.bad.append(f'{r.status} {r.url}'))
            p.on('dialog', lambda d: (ctx.errors.append('dialog: ' + d.message), d.dismiss()))
        ctx.on('page', on_page)
        return ctx


def test(fn):
    RESULTS.append(fn)
    return fn


def overflow(page):
    return page.evaluate('() => document.documentElement.scrollWidth - document.documentElement.clientWidth')


def fill_datos(page, p):
    page.wait_for_selector('#view-datos:not([hidden])', timeout=15000)
    page.fill('#full_name', p['full_name'])
    page.select_option('#doc_type', p['doc_type'])
    page.fill('#doc_number', p['doc_number'])
    page.fill('#email', p['email'])
    page.fill('#whatsapp', p['whatsapp'])
    page.check('#consent')
    page.click('#view-datos button[type=submit]')


def choose_race(page, distance='40K', cat_index=1):
    page.wait_for_selector('#view-carrera:not([hidden])', timeout=15000)
    page.check(f'input[name=distance][value="{distance}"]')
    page.wait_for_function('() => !document.getElementById("category").disabled')
    page.select_option('#category', index=cat_index)
    page.wait_for_timeout(400)


def pay(page, outcome='approve', expect_amount=None):
    page.wait_for_url(re.compile(r'localhost:8799/p/'), timeout=20000)
    sig = page.text_content('#sig')
    assert sig == 'FIRMA_OK', 'firma de integridad inválida en el checkout: ' + sig
    if expect_amount is not None:
        got = int(page.text_content('#amount'))
        assert got == expect_amount, f'monto enviado a la pasarela {got} != {expect_amount}'
    page.click('#' + outcome)
    page.wait_for_url(re.compile(r'/resultado\.html\?id='), timeout=20000)


def result_title(page, timeout=40000):
    page.wait_for_selector('#spinner[hidden]', state='attached', timeout=timeout)
    return page.text_content('#title'), page.text_content('#tag')


# ---------- pruebas ----------

@test
def sitio_publico(run):
    for mobile in (False, True):
        ctx = run.context(mobile=mobile)
        page = ctx.new_page()
        for path in ['index.html', 'recorrido.html', 'experiencia.html', 'info.html']:
            page.goto(f'{SITE}/{path}', wait_until='networkidle')
            page.wait_for_timeout(500)
            page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
            page.wait_for_timeout(500)
            assert overflow(page) <= 0, f'{path} desborda horizontalmente ({overflow(page)} px, móvil={mobile})'
            links = page.eval_on_selector_all('a[href]', 'as => as.map(a => a.getAttribute("href"))')
            for href in links:
                if href.startswith('http') or href.startswith('#') or href.startswith('mailto:'):
                    continue
                target = href.split('#')[0]
                if not target:
                    continue
                code = http('GET', f'{SITE}/{target}')[0]
                assert code == 200, f'enlace roto en {path}: {href} → {code}'
        assert not ctx.errors, f'errores de consola: {ctx.errors[:3]}'
        assert not ctx.bad, f'recursos con error: {ctx.bad[:5]}'
        ctx.close()


@test
def inscripciones_cerradas(run):
    sql("update events set registration_open = false")
    try:
        ctx = run.context()
        page = ctx.new_page()
        page.goto(f'{SITE}/inscripcion.html')
        page.wait_for_selector('#view-cerrado:not([hidden])', timeout=15000)
        ctx.close()
    finally:
        sql("update events set registration_open = true")


@test
def pago_completo_con_codigo_por_enlace(run):
    st, row, _ = admin('POST', '/admin/promo-codes', {'code': 'E2E10', 'type': 'percent', 'value': 10})
    assert st == 201, row
    p = person()
    ctx = run.context()
    page = ctx.new_page()
    page.goto(f'{SITE}/inscripcion.html?codigo=e2e10')
    fill_datos(page, p)
    choose_race(page)
    page.wait_for_function('() => /Código aplicado/.test(document.getElementById("promo-msg").textContent)', timeout=10000)
    assert page.text_content('#t-total') == '$99.000', page.text_content('#t-total')
    page.click('#view-carrera button[type=submit]')
    page.wait_for_selector('#view-pago:not([hidden])')
    page.check('input[name=plan][value=full]')
    assert 'pagar $99.000' in page.text_content('#pay-btn').lower(), repr(page.text_content('#pay-btn'))
    page.click('#pay-btn')
    pay(page, 'approve', 9_900_000)
    title, tag = result_title(page)
    assert title == 'Pago recibido', title
    page.click('#cta')
    page.wait_for_selector('#view-estado:not([hidden])')
    assert page.text_content('#estado-tag') == 'Inscripción confirmada'
    page.fill('#emergency_name', 'Contacto Prueba')
    page.fill('#emergency_phone', '3001112233')
    page.fill('#eps', 'Sura')
    page.click('#extra button')
    page.wait_for_function('() => document.getElementById("extra-msg").textContent === "Datos guardados."')
    assert sql(f"select redeemed_count from promo_codes where code = 'E2E10'")[0][0] == '1'
    msgs = messages_for(p['doc_number'], 'paid_full')
    assert msgs and link_token(msgs[0][1]), 'no se encoló la confirmación con enlace'
    assert not ctx.errors, ctx.errors
    run.paid_person = p
    ctx.close()


@test
def enlace_de_whatsapp_abre_la_inscripcion(run):
    p = run.paid_person
    token = link_token(messages_for(p['doc_number'], 'paid_full')[0][1])
    ctx = run.context(mobile=True)
    page = ctx.new_page()
    page.goto(f'{SITE}/inscripcion.html#t={token}')
    page.wait_for_selector('#view-estado:not([hidden])', timeout=15000)
    assert page.text_content('#estado-tag') == 'Inscripción confirmada'
    assert '#t=' not in page.url, 'el token sigue en la URL'
    assert overflow(page) <= 0
    ctx.close()


@test
def reserva_y_saldo(run):
    p = person()
    ctx = run.context(mobile=True)
    page = ctx.new_page()
    page.goto(f'{SITE}/inscripcion.html')
    fill_datos(page, p)
    choose_race(page, '25K', 1)
    page.click('#view-carrera button[type=submit]')
    page.wait_for_selector('#view-pago:not([hidden])')
    assert overflow(page) <= 0
    page.check('input[name=plan][value=split]')
    assert 'pagar $55.000' in page.text_content('#pay-btn').lower(), page.text_content('#pay-btn')
    page.click('#pay-btn')
    pay(page, 'approve', 5_500_000)
    title, _ = result_title(page)
    assert title == 'Reserva recibida', title
    page.click('#cta')
    page.wait_for_selector('#view-estado:not([hidden])')
    assert page.text_content('#estado-tag') == 'Cupo reservado'
    assert page.text_content('#due-amount') == '$55.000'
    assert len(messages_for(p['doc_number'], 'balance_reminder')) >= 1, 'no se programaron recordatorios del saldo'
    page.click('#pay-balance')
    pay(page, 'approve', 5_500_000)
    title, _ = result_title(page)
    assert title == 'Pago recibido', title
    pending = sql(f"select count(*) from notifications_outbox o join registrations r on r.id = o.registration_id join participants p on p.id = r.participant_id where p.doc_number = '{p['doc_number']}' and o.template like 'balance_%' and o.status = 'pending'")
    assert pending[0][0] == '0', 'quedaron recordatorios de saldo pendientes tras pagar'
    assert not ctx.errors, ctx.errors
    run.split_person = p
    ctx.close()


@test
def pago_rechazado_y_reintento(run):
    p = person()
    ctx = run.context()
    page = ctx.new_page()
    page.goto(f'{SITE}/inscripcion.html')
    fill_datos(page, p)
    choose_race(page)
    page.click('#view-carrera button[type=submit]')
    page.wait_for_selector('#view-pago:not([hidden])')
    page.click('#pay-btn')
    pay(page, 'decline')
    title, _ = result_title(page)
    assert title == 'El pago no se completó', title
    page.click('#cta')
    page.wait_for_selector('#view-pago:not([hidden])', timeout=15000)
    page.click('#pay-btn')
    pay(page, 'approve', 11_000_000)
    title, _ = result_title(page)
    assert title == 'Pago recibido', title
    assert messages_for(p['doc_number'], 'payment_failed'), 'no se avisó el pago rechazado'
    ctx.close()


@test
def pago_pendiente_que_se_aprueba_despues(run):
    p = person()
    ctx = run.context()
    page = ctx.new_page()
    page.goto(f'{SITE}/inscripcion.html')
    fill_datos(page, p)
    choose_race(page)
    page.click('#view-carrera button[type=submit]')
    page.wait_for_selector('#view-pago:not([hidden])')
    page.click('#pay-btn')
    pay(page, 'pending')
    txid = page.url.split('id=')[1].split('&')[0]
    page.wait_for_timeout(3500)
    http('POST', MOCK + '/control/settle', {'id': urllib.parse.unquote(txid), 'status': 'APPROVED'})
    title, _ = result_title(page, timeout=45000)
    assert title == 'Pago recibido', title
    ctx.close()


@test
def recuperacion_por_codigo(run):
    p = run.split_person
    ctx = run.context()
    page = ctx.new_page()
    page.goto(f'{SITE}/inscripcion.html')
    fill_datos(page, dict(p, full_name='Otra Persona', email='otra@example.com'))
    page.wait_for_selector('#view-recovery:not([hidden])', timeout=15000)
    page.wait_for_selector('#recovery-verify:not([hidden])', timeout=15000)
    code = otp_for(p['doc_number'])
    assert code, 'no se encoló el código'
    page.fill('#rec_code', '000000' if code != '000000' else '111111')
    page.click('#recovery-verify button')
    page.wait_for_selector('#alert:not([hidden])')
    assert 'incorrecto' in page.text_content('#alert')
    page.fill('#rec_code', code)
    page.click('#recovery-verify button')
    page.wait_for_selector('#view-estado:not([hidden])', timeout=15000)
    assert page.text_content('#estado-tag') == 'Inscripción confirmada'
    # El participante no cambió por el intento con otros datos.
    row = sql(f"select full_name, email from participants where doc_number = '{p['doc_number']}'")[0]
    assert row == [p['full_name'], p['email']], f'los datos del participante cambiaron: {row}'
    ctx.close()


@test
def codigo_personal_y_errores_de_codigo(run):
    st, _, _ = admin('POST', '/admin/promo-codes', {'code': 'SOLO-ANA', 'type': 'fixed', 'value': 2_000_000, 'allowed_doc_number': '11223344', 'max_redemptions': 1})
    assert st == 201
    p = person()
    ctx = run.context()
    page = ctx.new_page()
    page.goto(f'{SITE}/inscripcion.html')
    fill_datos(page, p)
    choose_race(page)
    for code, expect in [('SOLO-ANA', 'personal'), ('NO-EXISTE', 'no válido'), ('<b>x', 'no válido')]:
        page.fill('#promo', code)
        page.click('#promo-apply')
        page.wait_for_function('(e) => document.getElementById("promo-msg").textContent.toLowerCase().includes(e)', arg=expect, timeout=10000)
    assert page.text_content('#t-total') == '$110.000'
    ctx.close()


@test
def otra_persona_en_el_mismo_dispositivo(run):
    """Un papá inscribe a dos hijos desde el mismo teléfono."""
    a, b = person(), person()
    ctx = run.context(mobile=True)
    page = ctx.new_page()
    page.goto(f'{SITE}/inscripcion.html')
    fill_datos(page, a)
    choose_race(page)
    page.goto(f'{SITE}/inscripcion.html')
    page.wait_for_selector('#view-carrera:not([hidden])', timeout=15000)
    other = page.locator('#another')
    assert other.count() == 1 and other.is_visible(), 'no hay forma de inscribir a otra persona desde el mismo dispositivo'
    other.click()
    page.wait_for_selector('#another-box:not([hidden])')
    page.click('#another-go')
    assert page.evaluate('() => localStorage.getItem("xr_token")') is None, 'la sesión anterior siguió activa'
    fill_datos(page, b)
    page.wait_for_selector('#view-carrera:not([hidden])', timeout=15000)
    assert sql(f"select count(*) from participants where doc_number in ('{a['doc_number']}','{b['doc_number']}')")[0][0] == '2'
    ctx.close()


@test
def pasarela_sin_configurar_muestra_el_motivo(run):
    p = person()
    ctx = run.context(nogw=True)
    page = ctx.new_page()
    page.goto(f'{SITE}/inscripcion.html')
    fill_datos(page, p)
    choose_race(page)
    page.click('#view-carrera button[type=submit]')
    page.wait_for_selector('#view-pago:not([hidden])')
    page.click('#pay-btn')
    page.wait_for_selector('#alert:not([hidden])', timeout=15000)
    msg = page.text_content('#alert')
    assert 'no está habilitado' in msg, f'mensaje mostrado: "{msg}"'
    ctx.close()


@test
def panel_de_administracion(run):
    ctx = run.context()
    page = ctx.new_page()
    page.goto(f'{SITE}/admin.html')
    page.fill('#key', 'llave-equivocada')
    page.click('#login-form button')
    page.wait_for_selector('#login-alert:not([hidden])')
    assert 'incorrecta' in page.text_content('#login-alert')
    page.fill('#key', ADMIN)
    page.click('#login-form button')
    page.wait_for_selector('#panel:not([hidden])', timeout=15000)
    page.wait_for_selector('#tiles .tile')
    tiles = page.text_content('#tiles')
    assert 'Recaudado' in tiles
    # Códigos: lote, personal, QR, CSV
    page.click('[data-tab=codigos]')
    page.fill('#b-count', '3'); page.fill('#b-prefix', 'E2E'); page.fill('#b-value', '15')
    page.click('#batch-form button')
    page.wait_for_function('() => /códigos/.test(document.getElementById("codes-count").textContent)')
    page.fill('#p-doc', '55667788'); page.fill('#p-value', '50')
    page.click('#personal-form button')
    page.wait_for_selector('#qr-dialog[open]', timeout=10000)
    assert page.locator('#qr-svg svg').count() == 1
    assert '55667788' in page.text_content('#qr-desc')
    page.click('#qr-close')
    page.select_option('#batch-filter', '')
    with page.expect_download() as d:
        page.click('#codes-csv')
    csv_text = open(d.value.path(), encoding='utf-8-sig').read()
    assert 'E2E-' in csv_text
    # Pagos
    page.click('[data-tab=pagos]')
    page.wait_for_function('() => /pagos aprobados/.test(document.getElementById("ledger-total").textContent)')
    assert run.paid_person['full_name'] in page.text_content('#ledger')
    with page.expect_download() as d:
        page.click('#ledger-csv')
    run.ledger_csv = open(d.value.path(), encoding='utf-8-sig').read()
    # Control
    page.click('[data-tab=control]')
    page.wait_for_function('() => document.getElementById("verdict").textContent.length > 0')
    run.verdict = page.text_content('#verdict')
    page.click('#logout')
    page.wait_for_selector('#login:not([hidden])')
    assert page.evaluate('() => sessionStorage.getItem("xr_admin_key")') is None
    assert not ctx.errors, ctx.errors
    ctx.close()


@test
def nombre_malicioso_y_csv_seguro(run):
    for name in ['<img src=x onerror="window.__xss=1"> Perez', '=HYPERLINK("http://e.vil") Perez', 'Ana bit.ly/premio']:
        st, res, _ = api('POST', '/registrations', dict(person(name), consent=True))
        if st == 201:
            finding('media', 'Nombre con HTML/fórmulas aceptado', name)
        else:
            assert st == 422, (st, res)
    # Una nota del panel que empieza por = no puede convertirse en fórmula al abrir el CSV.
    st, _, _ = admin('POST', '/admin/promo-codes', {'code': 'CSV-E2E', 'type': 'percent', 'value': 5, 'note': '=1+2', 'batch': 'CSV'})
    assert st == 201
    ctx = run.context()
    page = ctx.new_page()
    page.goto(f'{SITE}/admin.html')
    page.fill('#key', ADMIN); page.click('#login-form button')
    page.wait_for_selector('#panel:not([hidden])', timeout=15000)
    page.click('[data-tab=codigos]')
    page.wait_for_function('() => /códigos/.test(document.getElementById("codes-count").textContent)')
    page.select_option('#batch-filter', 'CSV')
    with page.expect_download() as d:
        page.click('#codes-csv')
    text = open(d.value.path(), encoding='utf-8-sig').read()
    row = [l for l in text.splitlines() if 'CSV-E2E' in l][0]
    cells = row.split(';')
    note = cells[8]
    if note.startswith('='):
        finding('media', 'Inyección de fórmulas en el CSV', f'celda exportada: {note}')
    else:
        assert note == "'=1+2", note
    assert page.evaluate('() => window.__xss') is None
    assert not ctx.errors, ctx.errors
    ctx.close()


@test
def empezar_de_nuevo_si_el_whatsapp_quedo_mal(run):
    a = person()
    st, res, _ = api('POST', '/registrations', dict(a, whatsapp='3109999999', consent=True))  # número mal escrito
    assert st == 201
    ctx = run.context(mobile=True)
    page = ctx.new_page()
    page.goto(f'{SITE}/inscripcion.html')
    fill_datos(page, a)                                   # ahora con el número correcto
    page.wait_for_selector('#view-recovery:not([hidden])', timeout=15000)
    page.wait_for_selector('#restart:not([hidden])')
    page.click('#restart-open')
    page.click('#restart-go')
    page.wait_for_selector('#view-carrera:not([hidden])', timeout=15000)
    row = sql(f"select whatsapp_e164 from participants where doc_number = '{a['doc_number']}'")[0][0]
    assert row == '+57' + a['whatsapp'], row
    assert sql(f"select count(*) from registrations r join participants p on p.id = r.participant_id where p.doc_number = '{a['doc_number']}' and r.status = 'cancelled'")[0][0] == '1'
    assert overflow(page) <= 0
    assert not ctx.errors, ctx.errors
    ctx.close()


@test
def codigo_agotado_al_pagar_vuelve_al_paso_dos(run):
    admin('POST', '/admin/promo-codes', {'code': 'ULTIMO-E2E', 'type': 'percent', 'value': 20, 'max_redemptions': 1})
    # Otra persona aplica y paga el último cupo mientras esta persona sigue en el formulario.
    st, res, _ = api('POST', '/registrations', dict(person(), consent=True))
    other = res['resume_token']
    api('PATCH', '/registrations/me', {'distance': '40K', 'category': 'Open Masculino (18-29)', 'promo_code': 'ULTIMO-E2E'}, other)
    api('PUT', '/registrations/me/plan', {'plan': 'full'}, other)
    p = person()
    ctx = run.context()
    page = ctx.new_page()
    page.goto(f'{SITE}/inscripcion.html')
    fill_datos(page, p)
    choose_race(page)
    page.fill('#promo', 'ULTIMO-E2E'); page.click('#promo-apply')
    page.wait_for_function('() => /Código aplicado/.test(document.getElementById("promo-msg").textContent)')
    st, co, _ = api('POST', '/registrations/me/checkout', {}, other)
    http('POST', MOCK + '/control/webhook', {'tx': {'id': 'l-' + uuid.uuid4().hex[:8], 'reference': co['reference'], 'amount_in_cents': co['amount_in_cents'], 'currency': 'COP', 'status': 'APPROVED', 'payment_method_type': 'CARD'}})
    page.click('#view-carrera button[type=submit]')
    page.wait_for_selector('#view-pago:not([hidden])')
    page.click('#pay-btn')
    page.wait_for_selector('#view-carrera:not([hidden])', timeout=15000)
    page.wait_for_selector('#alert:not([hidden])')
    assert 'ULTIMO-E2E' in page.text_content('#alert'), page.text_content('#alert')
    assert 'localhost:8799' not in page.url, 'llegó a la pasarela con un código agotado'
    page.click('#promo-apply')                            # "Quitar"
    page.wait_for_function('() => /retirado/.test(document.getElementById("promo-msg").textContent)')
    assert page.text_content('#t-total') == '$110.000'
    ctx.close()


@test
def pago_tardio_sobre_inscripcion_vencida(run):
    p = person()
    st, res, _ = api('POST', '/registrations', dict(p, consent=True))
    tok = res['resume_token']
    api('PATCH', '/registrations/me', {'distance': '25K', 'category': 'Masculino'}, tok)
    api('PUT', '/registrations/me/plan', {'plan': 'full'}, tok)
    st, co, _ = api('POST', '/registrations/me/checkout', {}, tok)
    sql(f"update registrations set status = 'expired' where short_id = '{res['registration']['short_id']}'")
    tx = {'id': 't-' + uuid.uuid4().hex[:10], 'reference': co['reference'], 'amount_in_cents': co['amount_in_cents'], 'currency': 'COP', 'status': 'APPROVED', 'payment_method_type': 'CARD'}
    st, out, _ = http('POST', MOCK + '/control/webhook', {'tx': tx})
    assert out['json']['result'] == 'late_payment_review', out
    ctx = run.context(mobile=True)
    ctx.add_init_script("localStorage.setItem('xr_token', %s)" % json.dumps(tok))
    page = ctx.new_page()
    page.goto(f"{SITE}/resultado.html?id={tx['id']}&env=test")
    title, tag = result_title(page)
    assert title == 'Recibimos tu pago', title
    assert res['registration']['short_id'] in page.text_content('#lead')
    page.screenshot(path=SHOTS + '/resultado_tardio.png')
    ctx.close()


@test
def capturas_de_los_controles_nuevos(run):
    a = person()
    api('POST', '/registrations', dict(a, whatsapp='3108888888', consent=True))
    ctx = run.context(mobile=True)
    page = ctx.new_page()
    page.goto(f'{SITE}/inscripcion.html')
    fill_datos(page, a)
    page.wait_for_selector('#restart:not([hidden])', timeout=15000)
    page.click('#restart-open')
    page.wait_for_timeout(300)
    page.screenshot(path=SHOTS + '/recuperacion_empezar_de_nuevo.png', full_page=True)
    assert overflow(page) <= 0
    page.click('#restart-go')
    page.wait_for_selector('#view-carrera:not([hidden])', timeout=15000)
    page.click('#another')
    page.wait_for_timeout(300)
    page.screenshot(path=SHOTS + '/carrera_otra_persona.png', full_page=True)
    assert overflow(page) <= 0
    ctx.close()


@test
def un_solo_uso_no_se_puede_pagar_dos_veces(run):
    admin('POST', '/admin/promo-codes', {'code': 'UNICO-E2E', 'type': 'percent', 'value': 20, 'max_redemptions': 1})
    toks = []
    for _ in range(2):
        st, res, _ = api('POST', '/registrations', dict(person(), consent=True))
        tok = res['resume_token']
        st, r, _ = api('PATCH', '/registrations/me', {'distance': '40K', 'category': 'Open Masculino (18-29)', 'promo_code': 'UNICO-E2E'}, tok)
        assert st == 200 and r['discount_cents'] == 2_200_000, r
        api('PUT', '/registrations/me/plan', {'plan': 'full'}, tok)
        toks.append(tok)
    st, co, _ = api('POST', '/registrations/me/checkout', {}, toks[0])
    tx = {'id': 'u-' + uuid.uuid4().hex[:10], 'reference': co['reference'], 'amount_in_cents': co['amount_in_cents'], 'currency': 'COP', 'status': 'APPROVED', 'payment_method_type': 'CARD'}
    http('POST', MOCK + '/control/webhook', {'tx': tx})
    st, co2, _ = api('POST', '/registrations/me/checkout', {}, toks[1])
    if st == 201:
        finding('media', 'Código de un solo uso agotado se sigue cobrando con descuento',
                'Si dos personas aplican el mismo código y una paga, la otra todavía puede abrir el pago con el descuento (queda como uso extra).')
    else:
        assert co2['error']['code'].startswith('PROMO_'), co2


@test
def codigo_desactivado_no_se_cobra(run):
    admin('POST', '/admin/promo-codes', {'code': 'APAGAR-E2E', 'type': 'percent', 'value': 30})
    st, res, _ = api('POST', '/registrations', dict(person(), consent=True))
    tok = res['resume_token']
    api('PATCH', '/registrations/me', {'distance': '40K', 'category': 'Open Masculino (18-29)', 'promo_code': 'APAGAR-E2E'}, tok)
    api('PUT', '/registrations/me/plan', {'plan': 'full'}, tok)
    admin('POST', '/admin/promo-codes', {'code': 'APAGAR-E2E', 'type': 'percent', 'value': 30, 'active': False})
    st, co, _ = api('POST', '/registrations/me/checkout', {}, tok)
    if st == 201:
        finding('media', 'Código apagado se sigue aplicando al pagar', 'Desactivar un código no afecta a quien ya lo había aplicado: el pago se abre con el descuento.')


@test
def webhook_firma_monto_y_repeticion(run):
    st, res, _ = api('POST', '/registrations', dict(person(), consent=True))
    tok = res['resume_token']
    api('PATCH', '/registrations/me', {'distance': '25K', 'category': 'Femenino'}, tok)
    api('PUT', '/registrations/me/plan', {'plan': 'full'}, tok)
    st, co, _ = api('POST', '/registrations/me/checkout', {}, tok)
    tx = {'id': 'w-' + uuid.uuid4().hex[:10], 'reference': co['reference'], 'amount_in_cents': co['amount_in_cents'], 'currency': 'COP', 'status': 'APPROVED', 'payment_method_type': 'CARD'}
    st, out, _ = http('POST', MOCK + '/control/webhook', {'tx': tx, 'tamper': True})
    assert out['status'] == 401, f'evento alterado aceptado: {out}'
    st, out, _ = http('POST', MOCK + '/control/webhook', {'tx': dict(tx, id=tx['id'] + '-m', amount_in_cents=100)})
    assert out['json']['result'] == 'amount_mismatch', out
    st, out, _ = http('POST', MOCK + '/control/webhook', {'tx': tx})
    assert out['json']['result'] == 'paid', out
    st, out, _ = http('POST', MOCK + '/control/webhook', {'tx': tx})
    assert out['json']['result'] in ('duplicate', 'already_approved'), out
    st, out, _ = http('POST', MOCK + '/control/webhook', {'tx': dict(tx, status='PENDING')})
    assert out['json']['result'] in ('already_approved', 'stale_pending', 'duplicate'), out


@test
def robustez_de_la_api(run):
    st, res, _ = api('POST', '/registrations', dict(person(), consent=True))
    tok = res['resume_token']
    for d in ['constructor', '__proto__', 'toString']:
        st, out, _ = api('PATCH', '/registrations/me', {'distance': d, 'category': 'x'}, tok)
        if st >= 500:
            finding('baja', f'distancia "{d}" provoca error 500', 'El catálogo se consulta como objeto sin verificar propiedades propias.')
            break
    st, out, _ = api('PATCH', '/registrations/me', {'distance': 'constructor'}, tok)
    if st == 200 and out.get('distance') == 'constructor':
        finding('baja', 'Se guarda una distancia inexistente', 'PATCH acepta distance="constructor" sin categoría.')
    st, out, _ = api('GET', '/internal/outbox/due?limit=abc', token=INTERNAL)
    if st >= 500:
        finding('baja', 'limit no numérico en /internal/outbox/due da 500', '')
    st, out, _ = api('POST', '/registrations', raw=json.dumps({'full_name': 'a' * 40_000}).encode())
    if st != 413:
        finding('baja', 'Sin límite de tamaño de cuerpo', f'Un cuerpo de 40 KB se procesa completo (respuesta {st}).')
    try:  # con 3 MB el servidor responde 413 y corta la conexión sin leer el resto
        st, _, _ = api('POST', '/registrations', raw=json.dumps({'full_name': 'a' * 3_000_000}).encode())
        assert st == 413, st
    except urllib.error.URLError as e:
        assert 'Broken pipe' in str(e) or 'reset' in str(e).lower(), e
    st, out, _ = admin('POST', '/admin/promo-codes', {'code': 'MAL-E2E', 'type': 'percent', 'value': 5, 'per_document_limit': 'x'})
    if st >= 500:
        finding('baja', 'Datos inválidos del panel dan 500', 'per_document_limit no numérico no se valida.')


def main():
    only = set(sys.argv[1:])
    with sync_playwright() as pw:
        run = Run(pw)
        ok = 0
        for fn in RESULTS:
            if only and fn.__name__ not in only:
                continue
            t0 = time.time()
            sql('delete from rate_limits')  # todas las pruebas salen de la misma IP
            try:
                fn(run)
                ok += 1
                print(f'PASS  {fn.__name__}  ({time.time() - t0:.1f}s)', flush=True)
            except Exception as e:
                print(f'FAIL  {fn.__name__}: {e}', flush=True)
                traceback.print_exc(limit=2)
        total = len([f for f in RESULTS if not only or f.__name__ in only])
        print(f'\n{ok}/{total} pruebas pasan')
        if FINDINGS:
            print('\nHallazgos:')
            for s, t, d in FINDINGS:
                print(f'  [{s}] {t}: {d}')
        run.browser.close()
    sys.exit(0 if ok == total else 1)


if __name__ == '__main__':
    import urllib.parse
    main()
