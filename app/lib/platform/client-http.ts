let redirectingToLogin = false;

/**
 * Fetch para superficies autenticadas de la consola. Una sesión inexistente o
 * vencida vuelve a login conservando el destino; un 403 permanece en pantalla
 * para que la persona vea el límite real de su rol.
 */
export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401 && typeof window !== 'undefined' && !redirectingToLogin) {
    redirectingToLogin = true;
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`/login?return_to=${encodeURIComponent(returnTo)}`);
  }
  return response;
}
