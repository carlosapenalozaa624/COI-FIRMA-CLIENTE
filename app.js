/* ==========================================================
   Aceptación del servicio — lógica de la aplicación
   JavaScript puro + SignaturePad.js
   ========================================================== */
(function () {
  "use strict";

  /* ---------------- Configuración ---------------- */

  // URL del flujo de Power Automate (disparador "Cuando se recibe una solicitud HTTP")
  const API_URL = "https://default016ee934414e4f1d8b3ae3a65c72b8.0a.environment.api.powerplatform.com/powerautomate/automations/direct/cu/04/workflows/57aa5be4eb8d4cc99ea9022d2c50c6f1/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=G_HbYEII2XZEqyBobe4j8lazvhnI95Io6CYW1L-V90k";
  // URL del flujo de Power Automate que CONSULTA el reporte por token.
  // Recibe POST { "token": "..." } y responde { "idcoi", "reporte", "cliente" }
  const API_CONSULTA_URL = "https://default016ee934414e4f1d8b3ae3a65c72b8.0a.environment.api.powerplatform.com/powerautomate/automations/direct/cu/31/workflows/e698f423f7724272a9062b6f041fdc2d/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=BunC948zTfYmTgFweWJ2dpOXTOWBMOfQ6UupmSmw1ls";

  // Tiempo máximo de espera de la API (ms)
  const REQUEST_TIMEOUT_MS = 30000;

  // true  -> firma como "data:image/png;base64,XXXX"
  // false -> firma solo con el Base64 puro "XXXX" (más común en Power Automate)
  const FIRMA_CON_PREFIJO = false;

  const RATING_KEYS = ["amabilidad", "tiempo", "actitud", "calidad"];
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /* ---------------- Referencias al DOM ---------------- */

  const $ = (id) => document.getElementById(id);

  const form = $("signForm");
  const errorScreen = $("errorScreen");
  const successScreen = $("successScreen");
  const formAlert = $("formAlert");
  const submitBtn = $("submitBtn");
  const clearBtn = $("clearBtn");
  const nombreInput = $("nombre");
  const correoInput = $("correo");
  const canvas = $("signatureCanvas");
  const signatureWrap = $("signatureWrap");

  /* ---------------- Token (desde la URL) ---------------- */

  function getToken() {
    const token = new URLSearchParams(window.location.search).get("token");
    return token && token.trim() ? token.trim() : null;
  }

  /* ---------------- Consulta del reporte (por token) ---------------- */

  /**
   * Consulta los datos del reporte asociado al token.
   * Lanza un error si la API falla, tarda demasiado o no encuentra el token;
   * en cualquiera de esos casos la página muestra "Enlace no válido".
   */
  async function fetchReporte(token) {
    if (API_CONSULTA_URL === "REEMPLAZAR_POR_API_CONSULTA") {
      throw new Error("API_CONSULTA_URL sin configurar");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(API_CONSULTA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("HTTP " + response.status);

      const data = await response.json();
      if (!data || !data.idcoi || !data.reporte) {
        throw new Error("Token no encontrado o respuesta incompleta");
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Pinta idcoi, reporte y cliente en el encabezado (siempre con textContent). */
  function renderHeader(data) {
    // La API devuelve "002"; el encabezado lo muestra como "#002"
    $("reportNumber").textContent = "#" + String(data.reporte).replace(/^#/, "");
    $("caseId").textContent = String(data.idcoi);

    // El encabezado no tiene campo para el cliente: se agrega con el mismo estilo
    if (data.cliente) {
      const meta = document.querySelector(".meta");
      const item = document.createElement("div");
      item.className = "meta__item";

      const label = document.createElement("span");
      label.textContent = "CLIENTE";

      const value = document.createElement("strong");
      value.id = "clientName";
      value.textContent = String(data.cliente);

      item.appendChild(label);
      item.appendChild(value);
      meta.appendChild(item);
    }
  }

  /** Crea una pantalla de carga reutilizando las clases existentes (sin tocar HTML/CSS). */
  function createLoadingScreen() {
    loadingScreen = document.createElement("section");
    loadingScreen.id = "loadingScreen";
    loadingScreen.className = "card state";
    loadingScreen.setAttribute("role", "status");
    loadingScreen.innerHTML =
      '<div class="state__icon">⏳</div>' +
      "<h2>Cargando su reporte…</h2>" +
      "<p>Un momento, por favor.</p>";
    form.parentNode.insertBefore(loadingScreen, form);
  }

  /* ---------------- Firma (SignaturePad) ---------------- */

  let signaturePad = null;
  let lastCanvasWidth = 0;
  let loadingScreen = null; // se crea dinámicamente en init()

  /**
   * Ajusta la resolución interna del canvas al tamaño visible y a la densidad
   * de pantalla (retina). Redimensionar borra el canvas, por eso se conserva
   * el trazo actual y se restaura después.
   */
  function resizeCanvas() {
    const width = canvas.offsetWidth;
    // En móviles el scroll dispara "resize" por la barra del navegador:
    // solo reajustamos si cambió el ancho real.
    if (!width || width === lastCanvasWidth) return;
    lastCanvasWidth = width;

    const data = signaturePad.toData();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = width * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext("2d").scale(ratio, ratio);
    signaturePad.clear();
    signaturePad.fromData(data);
  }

  function initSignaturePad() {
    signaturePad = new SignaturePad(canvas, {
      penColor: "#0b2a4a",
      backgroundColor: "rgba(255,255,255,0)", // PNG con fondo transparente
      minWidth: 0.8,
      maxWidth: 2.6,
    });

    signaturePad.addEventListener("beginStroke", () => {
      signatureWrap.classList.add("has-ink");
      clearError("firma");
    });

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 250));
  }

  function clearSignature() {
    signaturePad.clear();
    signatureWrap.classList.remove("has-ink");
  }

  /** Devuelve la firma como PNG Base64 (según FIRMA_CON_PREFIJO). */
  function getSignaturePNG() {
    const dataUrl = signaturePad.toDataURL("image/png");
    return FIRMA_CON_PREFIJO ? dataUrl : dataUrl.split(",")[1];
  }

  /* ---------------- Mensajes de error ---------------- */

  function setError(key, message) {
    const el = document.querySelector('[data-error-for="' + key + '"]');
    if (el) el.textContent = message;

    if (key === "nombre" || key === "correo") $(key).classList.add("is-invalid");
    else if (key === "firma") signatureWrap.classList.add("is-invalid");
    else {
      const q = document.querySelector('.question[data-key="' + key + '"]');
      if (q) q.classList.add("is-invalid");
    }
  }

  function clearError(key) {
    const el = document.querySelector('[data-error-for="' + key + '"]');
    if (el) el.textContent = "";

    if (key === "nombre" || key === "correo") $(key).classList.remove("is-invalid");
    else if (key === "firma") signatureWrap.classList.remove("is-invalid");
    else {
      const q = document.querySelector('.question[data-key="' + key + '"]');
      if (q) q.classList.remove("is-invalid");
    }
  }

  function clearAllErrors() {
    ["nombre", "correo", "firma"].concat(RATING_KEYS).forEach(clearError);
    formAlert.hidden = true;
    formAlert.textContent = "";
  }

  function showAlert(message) {
    formAlert.textContent = message;
    formAlert.hidden = false;
  }

  /* ---------------- Validación ---------------- */

  function getRating(key) {
    const checked = form.querySelector('input[name="' + key + '"]:checked');
    return checked ? Number(checked.value) : null;
  }

  /** Valida todo el formulario. Devuelve true si es válido. */
  function validate() {
    clearAllErrors();
    let firstInvalid = null;
    const fail = (key, msg, el) => {
      setError(key, msg);
      if (!firstInvalid) firstInvalid = el;
    };

    const nombre = nombreInput.value.trim();
    const correo = correoInput.value.trim();

    if (!nombre) {
      fail("nombre", "Por favor escriba el nombre del titular o representante.", nombreInput);
    }

    if (!correo) {
      fail("correo", "Por favor ingrese un correo para enviarle el comprobante.", correoInput);
    } else if (!EMAIL_REGEX.test(correo)) {
      fail("correo", "El correo no parece válido. Ejemplo: nombre@empresa.com", correoInput);
    }

    RATING_KEYS.forEach((key) => {
      if (getRating(key) === null) {
        fail(key, "Seleccione una calificación de 1 a 5 estrellas.",
          document.querySelector('.question[data-key="' + key + '"]'));
      }
    });

    if (signaturePad.isEmpty()) {
      fail("firma", "Por favor firme en el recuadro para continuar.", signatureWrap);
    }

    if (firstInvalid) {
      firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
      if (typeof firstInvalid.focus === "function" && firstInvalid.tagName === "INPUT") {
        firstInvalid.focus({ preventScroll: true });
      }
      return false;
    }
    return true;
  }

  /* ---------------- Envío a la API ---------------- */

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    submitBtn.classList.toggle("is-loading", isLoading);
    submitBtn.querySelector(".btn__label").textContent =
      isLoading ? "Enviando…" : "Firmar y Enviar";
  }

  async function sendToApi(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitBtn.disabled) return; // evita doble envío

    if (!validate()) return;

    // 1. Leer token desde la URL
    const token = getToken();
    if (!token) {
      showScreen("error");
      return;
    }

    // 2. Armar JSON con la firma en PNG Base64
    const payload = {
      token: token,
      nombre: nombreInput.value.trim(),
      correo: correoInput.value.trim(),
      amabilidad: getRating("amabilidad"),
      tiempo: getRating("tiempo"),
      actitud: getRating("actitud"),
      calidad: getRating("calidad"),
      firma: getSignaturePNG(),
    };

    // 3. POST a la API (Power Automate)
    setLoading(true);
    try {
      if (API_URL === "REEMPLAZAR_POR_POWER_AUTOMATE") {
        throw new Error("API_URL sin configurar");
      }
      await sendToApi(payload);
      showScreen("success");
    } catch (err) {
      console.error("Error al enviar la aceptación:", err);
      const timedOut = err && err.name === "AbortError";
      showAlert(
        timedOut
          ? "La solicitud tardó demasiado. Verifique su conexión e intente de nuevo."
          : "No pudimos registrar su aceptación en este momento. Por favor intente nuevamente en unos minutos."
      );
      setLoading(false);
    }
  }

  /* ---------------- Pantallas ---------------- */

  function showScreen(name) {
    if (loadingScreen) loadingScreen.hidden = name !== "loading";
    form.hidden = name !== "form";
    errorScreen.hidden = name !== "error";
    successScreen.hidden = name !== "success";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------------- Inicialización ---------------- */

  async function init() {
    // 1. Leer token desde la URL (sin token no hay reporte que firmar)
    const token = getToken();
    if (!token) {
      showScreen("error");
      return;
    }

    // 2-3. Consultar la API y obtener idcoi, reporte y cliente
    createLoadingScreen();
    showScreen("loading");
    try {
      const data = await fetchReporte(token);
      renderHeader(data); // 4. Mostrar valores en el encabezado
    } catch (err) {
      // 5. Error de API o token no encontrado -> "Enlace no válido"
      console.error("No se pudo consultar el reporte:", err);
      showScreen("error");
      return;
    }

    // 6. Mismo flujo de siempre: formulario visible, firma y encuesta.
    // El canvas debe estar visible para medir su ancho, por eso va después.
    showScreen("form");
    initSignaturePad();

    // Limpia el error de cada campo apenas el usuario lo corrige
    nombreInput.addEventListener("input", () => clearError("nombre"));
    correoInput.addEventListener("input", () => clearError("correo"));
    RATING_KEYS.forEach((key) => {
      form.querySelectorAll('input[name="' + key + '"]').forEach((radio) =>
        radio.addEventListener("change", () => clearError(key))
      );
    });

    clearBtn.addEventListener("click", clearSignature);
    form.addEventListener("submit", handleSubmit);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
