const statementAssistant = (() => {
  const get = (id) => document.getElementById(id);
  const panel = get('statement-panel');
  const form = get('statement-form');
  const setup = get('statement-setup');
  const log = get('statement-log');
  const photo = get('statement-photo');
  const message = get('statement-message');
  const model = get('statement-model');
  const send = get('statement-send');
  const progress = get('statement-progress');
  const pastePanel = get('chatgpt-import');
  const pasteForm = get('chatgpt-import-form');
  const pasteInput = get('chatgpt-reply');
  const pasteButton = get('chatgpt-import-button');
  const pasteResults = get('chatgpt-import-results');
  const pasteStatus = get('chatgpt-import-status');
  const copyStatus = get('chatgpt-copy-status');
  const instructionsField = get('chatgpt-instructions-field');
  const instructionsInput = get('chatgpt-instructions');
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

  let transcript = [];
  let currentPhoto = '';
  let awaitingDetails = false;
  let pending = null;
  let conversation = new AbortController();
  let pastedImport = new AbortController();

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
    for (const control of [send, photo, message, model]) control.disabled = busy;
    progress.textContent = busy ? 'Analisando o extrato…' : '';
  }

  function newConversation() {
    conversation.abort();
    conversation = new AbortController();
    pending?.abort();
    pending = null;
    transcript = [];
    currentPhoto = '';
    awaitingDetails = false;
    form.reset();
    setBusy(false);
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

  function showImport(turn, { added, duplicates, invalid }, skipped, signal) {
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
        const status = appendText(item, 'p', '');
        status.setAttribute('role', 'status');
        status.hidden = true;
        accept.addEventListener('click', async () => {
          accept.disabled = true;
          try {
            const result = await expensesApp.importStatement([row], { force: true, signal });
            if (signal.aborted) return;
            if (result.added.length !== 1) throw new Error('Despesa inválida.');
            accept.remove();
            status.textContent = 'Despesa registrada.';
          } catch {
            if (signal.aborted) return;
            accept.disabled = false;
            status.textContent = 'Não foi possível salvar essa despesa. Tente novamente.';
          }
          status.hidden = false;
        });
      }
      review.append(list);
      turn.append(review);
    }
  }

  function importInstructions() {
    return [
      'Leia a foto de extrato que anexei e extraia apenas despesas debitadas em reais (BRL).',
      'Ignore saldos, totais, receitas, estornos, lançamentos pendentes, transferências entre minhas contas e pagamentos de fatura que já resumem compras.',
      'Preserve a descrição da linha, removendo CPF, números de conta ou cartão e chaves Pix. Use a data completa (AAAA-MM-DD) e o valor positivo em centavos inteiros. Exemplo: R$ 12,50 vira 1250.',
      'Se o ano ou a moeda estiverem incertos, pergunte antes de montar a lista. Pule as linhas ilegíveis ou duvidosas e conte essas linhas em skipped. Inclua no máximo 60 despesas por foto. Se houver mais, peça imagens menores.',
      'Para cada linha, use uma destas categorias: ' + JSON.stringify(expensesApp.categoryNames().slice(0, 80)) + '. Se estiver em dúvida, use Outros.',
      'Use reference somente para um identificador de transação visível na linha. Se estiver ausente, use null. Retorne um único bloco JSON, no formato abaixo. Os valores de exemplo servem apenas para mostrar o formato.',
      '{"rows":[{"description":"Exemplo de compra","date":"2026-01-10","cents":1250,"category":"Alimentação","reference":null}],"skipped":0}'
    ].join('\n\n');
  }

  function parsePastedReply(text) {
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      const blocks = [...text.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi)];
      if (blocks.length !== 1) throw new Error('Cole o bloco JSON da resposta do ChatGPT.');
      try {
        payload = JSON.parse(blocks[0][1]);
      } catch {
        throw new Error('O bloco JSON está incompleto. Copie o bloco inteiro no ChatGPT.');
      }
    }
    const rows = Array.isArray(payload) ? payload : payload?.rows;
    const skipped = payload?.skipped ?? 0;
    if (!Array.isArray(rows) || !Number.isSafeInteger(skipped) || skipped < 0 || skipped > 60) {
      throw new Error('Peça ao ChatGPT para seguir o formato das instruções e cole a nova resposta.');
    }
    if (rows.length > 60) throw new Error('Importe até 60 despesas por vez. Divida o extrato em partes menores.');
    return { rows, skipped };
  }

  function setPasteStatus(text, isError = false) {
    pasteStatus.textContent = text;
    pasteStatus.classList.toggle('chatgpt-import-error', isError);
  }

  get('chatgpt-copy').addEventListener('click', async () => {
    const prompt = importInstructions();
    const signal = pastedImport.signal;
    try {
      await navigator.clipboard.writeText(prompt);
      if (signal.aborted) return;
      instructionsField.hidden = true;
      copyStatus.textContent = 'Instruções copiadas.';
    } catch {
      if (signal.aborted) return;
      instructionsInput.value = prompt;
      instructionsField.hidden = false;
      instructionsInput.focus();
      instructionsInput.select();
      copyStatus.textContent = 'Copie o texto das instruções abaixo.';
    }
  });

  pasteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pasteButton.disabled) return;
    let parsed;
    try {
      parsed = parsePastedReply(pasteInput.value.trim());
    } catch (error) {
      setPasteStatus(error.message, true);
      pasteInput.focus();
      return;
    }
    pastedImport.abort();
    pastedImport = new AbortController();
    const { signal } = pastedImport;
    pasteButton.disabled = true;
    pasteInput.readOnly = true;
    setPasteStatus('Conferindo os lançamentos…');
    pasteResults.hidden = true;
    pasteResults.replaceChildren();
    try {
      const imported = await expensesApp.importStatement(parsed.rows, { signal });
      if (signal.aborted) return;
      pasteResults.hidden = false;
      showImport(pasteResults, imported, parsed.skipped, signal);
      if (!imported.invalid) pasteForm.reset();
      setPasteStatus('');
    } catch {
      if (!signal.aborted) setPasteStatus('Não foi possível salvar as despesas neste navegador. Tente novamente.', true);
    } finally {
      if (!signal.aborted) {
        pasteButton.disabled = false;
        pasteInput.readOnly = false;
      }
    }
  });

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, mode, history, message: text, model: model.value, categories: expensesApp.categoryNames() }),
        credentials: 'omit',
        redirect: 'error',
        signal: request.signal
      });
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
      currentPhoto = image;
      awaitingDetails = result.status === 'clarify';
      const answer = result.reply || (imported ? 'Leitura concluída.' : 'Confira a foto e tente novamente.');
      const turn = addTurn('assistant', answer);
      if (imported) {
        showImport(turn, imported, result.skipped, conversation.signal);
        scrollLog();
      }
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
      newConversation();
      panel.open = false;
      pastedImport.abort();
      pastedImport = new AbortController();
      pasteForm.reset();
      pasteButton.disabled = false;
      pasteInput.readOnly = false;
      pasteResults.replaceChildren();
      pasteResults.hidden = true;
      instructionsInput.value = '';
      instructionsField.hidden = true;
      copyStatus.textContent = '';
      setPasteStatus('');
      pastePanel.open = false;
    }
  };
})();
