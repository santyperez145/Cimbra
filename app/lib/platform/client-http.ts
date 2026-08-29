let redirectingToLogin = false;

const unavailableMessage = 'No pudimos conectar con Cimbra. Reintentá en unos segundos.';

function normalizedErrorResponse(status = 503) {
  return Response.json({ error: unavailableMessage }, {
    status,
    headers: { 'Cimbra-Should-Retry': status >= 500 ? 'true' : 'false' },
  });
}

/**
 * Fetch para superficies autenticadas de la consola. Una sesión inexistente o
 * vencida vuelve a login conservando el destino; un 403 permanece en pantalla
 * para que la persona vea el límite real de su rol.
 */
export async function jsonFetch(input: RequestInfo | URL, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    console.error('Cimbra API request failed', error instanceof Error ? error.message : String(error));
    return normalizedErrorResponse();
  }
  if (response.status !== 204) {
    const mediaType = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
    if (mediaType !== 'application/json' && !mediaType.endsWith('+json')) {
      console.error('Cimbra API returned a non-JSON response', response.status);
      return normalizedErrorResponse(response.ok ? 502 : response.status);
    }
    try {
      await response.clone().json();
    } catch (error) {
      console.error('Cimbra API returned invalid JSON', error instanceof Error ? error.message : String(error));
      return normalizedErrorResponse(response.ok ? 502 : response.status);
    }
  }
  return response;
}

export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await jsonFetch(input, init);
  if (response.status === 401 && typeof window !== 'undefined' && !redirectingToLogin) {
    redirectingToLogin = true;
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`/login?return_to=${encodeURIComponent(returnTo)}`);
  }
  return response;
}
