const demoUser = 'admin';
const demoPassword = 'despesas123';
const sessionKey = 'despesas.demo.login';

const login = document.querySelector('#login-page');
const account = document.querySelector('#account');
const form = document.querySelector('#login-form');
const username = document.querySelector('#username');
const password = document.querySelector('#password');
const passwordToggle = document.querySelector('#password-toggle');
const error = document.querySelector('#login-error');
const logout = document.querySelector('#logout');
const submit = document.querySelector('#login-submit');

function setPasswordVisibility(visible) {
  password.type = visible ? 'text' : 'password';
  const fieldName = githubExpenses.enabled ? 'código' : 'senha';
  passwordToggle.textContent = (visible ? 'Ocultar ' : 'Mostrar ') + fieldName;
}

function showAccount(signedIn, moveFocus = false) {
  login.hidden = signedIn;
  account.hidden = !signedIn;

  if (signedIn) {
    expensesApp.open();
  } else {
    statementAssistant.close();
    advisorApp.close();
    expensesApp.close();
    document.title = 'Despesas | Login';
  }

  if (moveFocus) {
    document.querySelector(signedIn ? '#view-title' : '#login-title').focus();
  }
}

passwordToggle.addEventListener('click', () => {
  setPasswordVisibility(password.type === 'password');
});

form.addEventListener('input', () => {
  error.textContent = '';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submit.disabled) return;

  if (githubExpenses.enabled) {
    submit.disabled = true;
    error.textContent = '';
    try {
      await githubExpenses.login(password.value);
    } catch (failure) {
      error.textContent = failure.message;
      return;
    } finally {
      submit.disabled = false;
    }
  } else if (username.value.trim() !== demoUser || password.value !== demoPassword) {
    error.textContent = 'Usuário ou senha incorretos.';
    return;
  } else {
    try {
      sessionStorage.setItem(sessionKey, demoUser);
    } catch {
      // O login funciona na página atual quando o navegador bloqueia o armazenamento.
    }
  }

  form.reset();
  setPasswordVisibility(false);
  error.textContent = '';
  showAccount(true, true);
});

logout.addEventListener('click', () => {
  githubExpenses.logout();
  try {
    sessionStorage.removeItem(sessionKey);
  } catch {
    // A interface também encerra o acesso quando não há armazenamento disponível.
  }

  showAccount(false, true);
});

window.addEventListener('expenses-session-expired', () => {
  showAccount(false, true);
  error.textContent = 'Sua sessão expirou. Entre novamente.';
});

async function initializeLogin() {
  submit.disabled = true;
  await githubExpenses.initialize();
  submit.disabled = false;
  if (githubExpenses.enabled) {
    document.querySelector('#username-field').hidden = true;
    username.required = false;
    document.querySelector('#login-intro').textContent = 'Use seu código de acesso para abrir a base compartilhada.';
    document.querySelector('#password-label').textContent = 'Código de acesso';
    setPasswordVisibility(false);
    showAccount(githubExpenses.hasSession());
    return;
  }
  if (githubExpenses.awaitingSetup) {
    document.querySelector('#login-intro').textContent = 'A base compartilhada aguarda configuração. Entre para consultar os dados deste navegador.';
  }
  try {
    showAccount(sessionStorage.getItem(sessionKey) === demoUser);
  } catch {
    // A tela de login já fica visível por padrão.
  }
}

initializeLogin();
