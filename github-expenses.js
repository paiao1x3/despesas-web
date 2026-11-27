const githubExpenses = (() => {
  const sessionKey = 'despesas.github.session.v1';
  const endpoint = expensesEndpoint;
  let token = '';
  let awaitingSetup = false;

  function setToken(value) {
    token = value;
    try {
      if (value) sessionStorage.setItem(sessionKey, value);
      else sessionStorage.removeItem(sessionKey);
    } catch {
      // A sessão continua disponível nesta aba se o armazenamento estiver bloqueado.
    }
  }

  if (endpoint) {
    try {
      token = sessionStorage.getItem(sessionKey) || '';
    } catch {
      // O acesso pode ser iniciado novamente pelo formulário.
    }
  }

  async function request(path, method, payload, signal) {
    const authenticated = path === '';
    const currentToken = token;
    const headers = {};
    if (authenticated) headers.Authorization = 'Bearer ' + currentToken;
    if (payload) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetch(endpoint + path, {
        method, headers, signal, cache: 'no-store', body: payload && JSON.stringify(payload)
      });
    } catch {
      signal?.throwIfAborted();
      throw new Error('Não foi possível conectar à base compartilhada. Confira sua conexão e tente novamente.');
    }

    if (authenticated && response.status === 401 && token === currentToken) {
      setToken('');
      window.dispatchEvent(new Event('expenses-session-expired'));
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) {
      const error = new Error(result?.error || 'A base compartilhada ficou indisponível. Tente novamente.');
      error.status = response.status;
      throw error;
    }
    return result;
  }

  return {
    get enabled() { return Boolean(endpoint) && !awaitingSetup; },
    get awaitingSetup() { return awaitingSetup; },
    async initialize() {
      if (!endpoint) return;
      try {
        const result = await request('/status', 'GET', undefined, AbortSignal.timeout(8000));
        awaitingSetup = result.configured === false;
      } catch {
        // Uma falha de conexão preserva o modo compartilhado.
      }
    },
    hasSession: () => Boolean(token),
    async login(password) {
      const result = await request('/session', 'POST', { password });
      if (typeof result.token !== 'string' || !result.token) throw new Error('Não foi possível iniciar sua sessão.');
      setToken(result.token);
    },
    logout: () => setToken(''),
    read: (signal) => request('', 'GET', undefined, signal),
    write: (snapshot, signal) => request('', 'PUT', snapshot, signal)
  };
})();
