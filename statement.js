const statementAssistant = (() => {
  const get = (id) => document.getElementById(id);
  const panel = get('statement-panel');
  const form = get('statement-form');
  const setup = get('statement-setup');
  const log = get('statement-log');
  const codeField = get('statement-code-field');
  const code = get('statement-code');
  const photo = get('statement-photo');
  const message = get('statement-message');
  const model = get('statement-model');
  const send = get('statement-send');
  const progress = get('statement-progress');
  const maxImageBytes = 6 * 1024 * 1024;
  const allowedImages = ['image/jpeg', 'image/png', 'image/webp'];

  const endpoint = (() => {
    try {
      const configured = new URL(statementEndpoint);
      if (configured.protocol === 'https:' && !configured.username && !configured.password) return configured.href;
    } catch {
      // O endereço local só é usado durante o desenvolvimento.
    }
    if (location.origin === 'http://127.0.0.1:4173') return 'http://127.0.0.1:8787/api/statement';
    return '';
  })();

  let accessToken = '';
  let transcript = [];
  let currentPhoto = '';
  let awaitingDetails = false;
  let pending = null;
  let conversation = new AbortController();

  setup.hidden = Boolean(endpoint);
  form.hidden = !endpoint;

  const modelPreference = 'despesas.statement.model';
  try {
    const savedModel = localStorage.getItem(modelPreference);
    if ([...model.options].some((option) => option.value === savedModel)) model.value = savedModel;
  } catch {
    // A seleção continua disponível na aba atual.
  }
  model.addEventListener('change', () => {
    try {
      localStorage.setItem(modelPreference, model.value);
    } catch {
      // A seleção continua disponível na aba atual.
    }
  });

  function appendText(parent, tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    parent.append(element);
    return element;
  }

  function scrollLog() {
    log.scrollTop = log.scrollHeight;
  }

  function addTurn(author, text, isError = false) {
    const turn = document.createElement('div');
    turn.className = 'statement-turn';
    turn.dataset.author = author;
    appendText(turn, 'strong', author === 'user' ? 'Você' : 'Assistente');
    appendText(turn, 'p', text, isError ? 'statement-error' : '');
    log.append(turn);
    scrollLog();
    return turn;
  }

  function setBusy(busy) {
    for (const control of [send, photo, message, code, model]) control.disabled = busy;
    progress.textContent = busy ? 'Analisando o extrato…' : '';
  }

  function newConversation(clearAccess = false) {
    conversation.abort();
    conversation = new AbortController();
    pending?.abort();
    pending = null;
    transcript = [];
    currentPhoto = '';
    awaitingDetails = false;
    if (clearAccess) accessToken = '';
    form.reset();
    setBusy(false);
    codeField.hidden = Boolean(accessToken);
    log.replaceChildren();
    if (endpoint) addTurn('assistant', 'Anexe uma foto do extrato. Você também pode indicar o mês e o ano ou fazer perguntas sobre a leitura.');
  }

  function readPhoto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Não foi possível abrir a foto. Selecione o arquivo novamente.'));
      reader.readAsDataURL(file);
    });
  }

  function showImport(turn, { added, duplicates, invalid }, skipped) {
    const missed = invalid + skipped;
    const summary = [
      added.length + (added.length === 1 ? ' despesa registrada.' : ' despesas registradas.'),
      duplicates.length ? duplicates.length + (duplicates.length === 1 ? ' possível duplicata.' : ' possíveis duplicatas.') : '',
      missed ? missed + (missed === 1 ? ' linha precisa ser conferida.' : ' linhas precisam ser conferidas.') : ''
    ].filter(Boolean).join(' ');
    appendText(turn, 'p', summary);
    if (added.length) {
      const breakdown = document.createElement('details');
      appendText(breakdown, 'summary', 'Ver despesas registradas');
      const list = document.createElement('ul');
      for (const expense of added) appendText(list, 'li', expensesApp.formatExpense(expense));
      breakdown.append(list);
      turn.append(breakdown);
    }
    if (duplicates.length) {
      const review = document.createElement('details');
      appendText(review, 'summary', 'Revisar possíveis duplicatas');
      const list = document.createElement('ul');
      for (const { row, matching } of duplicates) {
        const item = appendText(list, 'li', expensesApp.formatExpense(row));
        appendText(item, 'p', 'Parecido com o lançamento ' + expensesApp.formatExpense(matching));
        const accept = appendText(item, 'button', 'Lançar mesmo assim', 'quiet-button');
        accept.type = 'button';
        accept.setAttribute('aria-label', 'Lançar mesmo assim: ' + expensesApp.formatExpense(row));
        const signal = conversation.signal;
        accept.addEventListener('click', async () => {
          accept.disabled = true;
          try {
            const result = await expensesApp.importStatement([row], { force: true, signal });
            if (signal.aborted) return;
            if (result.added.length !== 1) throw new Error('Despesa inválida.');
            accept.remove();
            const status = appendText(item, 'p', 'Despesa registrada.');
            status.setAttribute('role', 'status');
          } catch {
            if (signal.aborted) return;
            accept.disabled = false;
            addTurn('assistant', 'Não foi possível salvar essa despesa neste navegador. Tente novamente.', true);
          }
        });
      }
      review.append(list);
      turn.append(review);
    }
    scrollLog();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!endpoint || pending) return;
    const file = photo.files[0];
    const text = message.value.trim();
    if (!file && !text) {
      addTurn('assistant', 'Anexe uma foto ou escreva uma mensagem.');
      return;
    }
    if (!file && !currentPhoto) {
      addTurn('user', text);
      addTurn('assistant', 'Anexe uma foto do extrato para começar.');
      return;
    }
    if (file && (!allowedImages.includes(file.type) || !file.size || file.size > maxImageBytes)) {
      addTurn('assistant', 'Selecione uma foto JPG, PNG ou WebP de até 6 MB.', true);
      photo.focus();
      return;
    }
    const token = accessToken || code.value.trim();
    if (!token) {
      addTurn('assistant', 'Informe o código de acesso à IA para enviar o extrato.', true);
      code.focus();
      return;
    }

    const request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 100000);
    pending = request;
    setBusy(true);
    addTurn('user', [text, file ? 'Foto anexada: ' + file.name : ''].filter(Boolean).join('\n'));
    try {
      const image = file ? await readPhoto(file) : currentPhoto;
      const mode = file || awaitingDetails ? 'extract' : 'answer';
      const history = file ? [] : transcript.slice(-6);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, mode, history, message: text, model: model.value, categories: expensesApp.categoryNames() }),
        credentials: 'omit',
        redirect: 'error',
        signal: request.signal
      });
      if (response.status === 401) {
        accessToken = '';
        codeField.hidden = false;
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'O serviço de IA está indisponível.');
      if (pending !== request || request.signal.aborted) return;
      const validStatuses = mode === 'extract' ? ['parsed', 'clarify', 'unreadable'] : ['answer'];
      if (!validStatuses.includes(result.status) || typeof result.reply !== 'string'
        || !Array.isArray(result.rows) || !Number.isSafeInteger(result.skipped) || result.skipped < 0) {
        throw new Error('A resposta da IA veio incompleta. Tente novamente.');
      }

      let imported;
      if (result.status === 'parsed') {
        try {
          imported = await expensesApp.importStatement(result.rows, { signal: request.signal });
        } catch {
          throw new Error('As despesas não puderam ser salvas neste navegador. Confira o armazenamento antes de tentar novamente.');
        }
      }
      if (pending !== request) return;
      accessToken = token;
      code.value = '';
      codeField.hidden = true;
      currentPhoto = image;
      awaitingDetails = result.status === 'clarify';
      const answer = result.reply || (imported ? 'Leitura concluída.' : 'Confira a foto e tente novamente.');
      const turn = addTurn('assistant', answer);
      if (imported) showImport(turn, imported, result.skipped);
      transcript = [
        ...history,
        { author: 'user', text },
        { author: 'assistant', text: answer + (imported
          ? ' O aplicativo registrou ' + imported.added.length + ' despesa(s) e separou ' + imported.duplicates.length + ' possível(is) duplicata(s).'
          : '') }
      ].slice(-6);
      form.reset();
    } catch (error) {
      if (pending !== request) return;
      const explanation = request.signal.aborted ? 'A leitura demorou demais. Tente novamente.'
        : error instanceof TypeError ? 'Não foi possível conectar ao assistente. Verifique o serviço e a conexão.'
          : error.message;
      addTurn('assistant', explanation, true);
    } finally {
      clearTimeout(timeout);
      if (pending === request) {
        pending = null;
        setBusy(false);
      }
    }
  });

  get('statement-clear').addEventListener('click', () => {
    newConversation();
    photo.focus();
  });
  newConversation();

  return {
    close() {
      newConversation(true);
      panel.open = false;
    }
  };
})();
