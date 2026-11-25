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

function setPasswordVisibility(visible) {
  password.type = visible ? 'text' : 'password';
  passwordToggle.textContent = visible ? 'Ocultar senha' : 'Mostrar senha';
}

function showAccount(signedIn, moveFocus = false) {
  login.hidden = signedIn;
  account.hidden = !signedIn;

  if (signedIn) {
    expensesApp.open();
  } else {
    statementAssistant.close();
    advisorApp.close();
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

form.addEventListener('submit', (event) => {
  event.preventDefault();

  if (username.value.trim() !== demoUser || password.value !== demoPassword) {
    error.textContent = 'Usuário ou senha incorretos.';
    return;
  }

  try {
    sessionStorage.setItem(sessionKey, demoUser);
  } catch {
    // O login funciona na página atual quando o navegador bloqueia o armazenamento.
  }

  form.reset();
  setPasswordVisibility(false);
  error.textContent = '';
  showAccount(true, true);
});

logout.addEventListener('click', () => {
  try {
    sessionStorage.removeItem(sessionKey);
  } catch {
    // A interface também encerra o acesso quando não há armazenamento disponível.
  }

  showAccount(false, true);
});

try {
  showAccount(sessionStorage.getItem(sessionKey) === demoUser);
} catch {
  // A tela de login já fica visível por padrão.
}
