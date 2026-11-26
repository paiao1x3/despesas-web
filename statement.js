const statementAssistant = (() => {
  const get = (id) => document.getElementById(id);
  const panel = get('statement-panel');
  const form = get('statement-form');
  const setup = get('statement-setup');
  const log = get('statement-log');
  const fileInput = get('statement-file');
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
  const maxFileBytes = 6 * 1024 * 1024;
  const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  const fileTypes = new Map([
    ['pdf', 'application/pdf'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'],
    ['png', 'image/png'], ['webp', 'image/webp']
  ]);

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
  let currentFile = '';
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
    for (const control of [send, fileInput, message, model]) control.disabled = busy;
    progress.textContent = busy ? 'Analisando o arquivo…' : '';
  }

  function newConversation() {
    conversation.abort();
    conversation = new AbortController();
    pending?.abort();
    pending = null;
    transcript = [];
    currentFile = '';
    awaitingDetails = false;
    form.reset();
    setBusy(false);
    log.replaceChildren();
    if (endpoint) addTurn('assistant', 'Anexe o extrato bancário ou a fatura do cartão em PDF ou imagem. Você também pode indicar o mês e o ano.');
  }

  function documentType(file) {
    if (file.type === 'application/x-pdf') return 'application/pdf';
    if (!file.type || file.type === 'application/octet-stream') {
      return fileTypes.get(file.name.toLowerCase().split('.').at(-1));
    }
    return file.type;
  }

  function readFile(file, type) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.slice(reader.result.indexOf(',') + 1);
        resolve('data:' + type + ';base64,' + base64);
      };
      reader.onerror = () => reject(new Error('Não foi possível abrir o arquivo. Selecione-o novamente.'));
      reader.readAsDataURL(file);
    });
  }

  function reportList(turn, title) {
    const section = document.createElement('details');
    section.open = true;
    appendText(section, 'summary', title);
    const list = appendText(section, 'ul', '');
    turn.append(section);
    return list;
  }

  function appendReportLines(turn, title, rows) {
    if (!rows.length) return;
    const list = reportList(turn, title);
    for (const row of rows) {
      const item = appendText(list, 'li', expensesApp.formatExpense(row));
      appendText(item, 'p', row.reason);
    }
  }

  function showImport(turn, { added, duplicates, invalid, excluded }, { notes, skipped }, signal, owner, documentType) {
    const review = [...invalid, ...notes.filter((row) => row.kind === 'review')];
    const ignored = [...excluded, ...notes.filter((row) => row.kind === 'ignored')];
    const summary = appendText(turn, 'p', '');
    let pendingDuplicates = duplicates.length;
    let savedCount = 0;
    let uncategorizedCount = 0;
    const savedList = reportList(turn, 'Despesas registradas');
    savedList.parentElement.hidden = true;

    function updateSummary() {
      summary.textContent = [
        savedCount + (savedCount === 1 ? ' despesa registrada.' : ' despesas registradas.'),
        uncategorizedCount ? uncategorizedCount + ' em Outros para revisar a categoria.' : '',
        review.length ? review.length + (review.length === 1 ? ' linha precisa de confirmação.' : ' linhas precisam de confirmação.') : '',
        pendingDuplicates ? pendingDuplicates + (pendingDuplicates === 1 ? ' possível duplicata.' : ' possíveis duplicatas.') : '',
        ignored.length ? ignored.length + (ignored.length === 1 ? ' linha ignorada.' : ' linhas ignoradas.') : ''
      ].filter(Boolean).join(' ');
    }

    function appendSaved(expense) {
      savedCount++;
      savedList.parentElement.hidden = false;
      const item = appendText(savedList, 'li', expensesApp.formatExpense(expense));
      if (expense.category === 'Outros') {
        uncategorizedCount++;
        appendText(item, 'p', 'Despesa registrada em Outros. Confira se há uma categoria mais adequada.');
      }
    }

    for (const expense of added) appendSaved(expense);
    updateSummary();
    appendReportLines(turn, 'Linhas que precisam de confirmação', review);
    if (skipped) {
      appendText(turn, 'p', skipped + (skipped === 1
        ? ' linha ficou sem detalhes na resposta da IA.' : ' linhas ficaram sem detalhes na resposta da IA.'));
    }
    if (duplicates.length) {
      const list = reportList(turn, 'Possíveis duplicatas');
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
            const result = await expensesApp.importStatement([row], { owner, force: true, signal, documentType });
            if (signal.aborted) return;
            if (result.added.length !== 1) throw new Error('Despesa inválida.');
            pendingDuplicates--;
            appendSaved(result.added[0]);
            updateSummary();
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
    }
    appendReportLines(turn, 'Linhas ignoradas', ignored);
  }

  function importInstructions() {
    return [
      'Leia o extrato bancário ou a fatura de cartão que anexei. Confira todas as páginas. Em extratos, extraia despesas efetivamente debitadas em reais (BRL). Em faturas, extraia as compras, parcelas e tarifas individuais cobradas nesta fatura em BRL.',
      'Liste cada movimentação visível uma vez, em rows ou notes. Preserve linhas separadas com a mesma data, descrição e valor. Nos dois tipos de documento, registre em notes com kind ignored os pagamentos e totais de fatura, saldos, subtotais visíveis, entradas (inclusive resgates de investimentos), estornos, pendências e transferências identificadas entre minhas contas. Preserve pagamentos a comerciantes e contas de consumo que sejam despesas reais.',
      'Use notes com kind review para cada linha cuja finalidade, data, moeda ou valor não puder confirmar, inclusive Pix enviado a pessoa sem indicação do motivo. Explique o que falta em reason. Em cada nota, use data AAAA-MM-DD e valor em centavos conforme o sinal visível, ou null quando o campo não puder ser confirmado. Omita o valor em centavos quando a moeda for incerta ou diferente de BRL.',
      'Preserve a descrição sem CPF, números de conta ou cartão e chaves Pix. Em rows, use a data completa (AAAA-MM-DD) e o valor positivo em centavos inteiros. Exemplo: R$ 12,50 vira 1250. Se faltar ano ou moeda para todo o arquivo, pergunte antes de montar a lista. Se houver mais de 60 despesas ou 100 notas, peça que eu divida o arquivo em partes.',
      'Para cada despesa confirmada em rows, use uma destas categorias: ' + JSON.stringify(expensesApp.categoryNames().slice(0, 80)) + '. Se tiver certeza de que é despesa, mas não conseguir identificar uma categoria, mantenha a linha em rows com categoria Outros.',
      'Use reference somente para um identificador de transação visível na linha. Se estiver ausente, use null. Em documentType, escreva extrato, fatura, misto (se houver os dois) ou indefinido. Retorne um único bloco JSON no formato abaixo.',
      '{"documentType":"misto","rows":[{"description":"Exemplo de compra","date":"2026-01-10","cents":1250,"category":"Alimentação","reference":null}],"notes":[{"kind":"review","description":"Pix enviado","date":"2026-01-10","cents":-15000,"reason":"O documento não informa a finalidade do Pix."}]}'
    ].join('\n\n');
  }

  function readAudit(payload) {
    const notes = payload?.notes === undefined ? [] : payload.notes;
    const skipped = payload?.skipped ?? 0;
    if (!Number.isSafeInteger(skipped) || skipped < 0 || skipped > 60 || !Array.isArray(notes) || notes.length > 100 ||
        notes.some((note) => !['review', 'ignored'].includes(note?.kind) ||
          typeof note.description !== 'string' || !note.description.trim() ||
          typeof note.reason !== 'string' || !note.reason.trim() ||
          (note.date !== null && typeof note.date !== 'string') ||
          (note.cents !== null && !Number.isSafeInteger(note.cents)))) return null;
    return {
      skipped,
      notes: notes.map(({ kind, description, date, cents, reason }) => ({
        kind, description: description.trim().slice(0, 100), date, cents, reason: reason.trim().slice(0, 200)
      }))
    };
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
    const audit = readAudit(payload);
    if (!Array.isArray(rows) || !audit) {
      throw new Error('Peça ao ChatGPT para seguir o formato das instruções e cole a nova resposta.');
    }
    if (rows.length > 60) throw new Error('Importe até 60 despesas por vez. Divida o arquivo em partes menores.');
    return { rows, audit, documentType: payload?.documentType };
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
    const owner = expensesApp.getExpenseOwner();
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
      const { rows, audit, documentType } = parsed;
      const imported = await expensesApp.importStatement(rows, { owner, signal, documentType });
      if (signal.aborted) return;
      pasteResults.hidden = false;
      showImport(pasteResults, imported, audit, signal, owner, documentType);
      if (!imported.invalid.length) pasteForm.reset();
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
    const owner = expensesApp.getExpenseOwner();
    const file = fileInput.files[0];
    const text = message.value.trim();
    if (!file && !text) {
      addTurn('assistant', 'Anexe um extrato ou uma fatura, ou escreva uma mensagem.');
      return;
    }
    if (!file && !currentFile) {
      addTurn('user', text);
      addTurn('assistant', 'Anexe um extrato ou uma fatura em PDF ou imagem para começar.');
      return;
    }
    const type = file && documentType(file);
    if (file && (!allowedTypes.has(type) || !file.size || file.size > maxFileBytes)) {
      addTurn('assistant', 'Selecione um arquivo PDF, JPG, PNG ou WebP de até 6 MB.', true);
      fileInput.focus();
      return;
    }
    const request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 100000);
    pending = request;
    setBusy(true);
    addTurn('user', [text, file ? 'Arquivo anexado: ' + file.name : ''].filter(Boolean).join('\n'));
    try {
      const attachment = file ? await readFile(file, type) : currentFile;
      const mode = file || awaitingDetails ? 'extract' : 'answer';
      const history = file ? [] : transcript.slice(-6);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: attachment, mode, history, message: text, model: model.value, categories: expensesApp.categoryNames(owner) }),
        credentials: 'omit',
        redirect: 'error',
        signal: request.signal
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'O serviço de IA está indisponível.');
      if (pending !== request || request.signal.aborted) return;
      const validStatuses = mode === 'extract' ? ['parsed', 'clarify', 'unreadable'] : ['answer'];
      const audit = readAudit(result);
      if (!validStatuses.includes(result.status) || typeof result.reply !== 'string'
        || !Array.isArray(result.rows) || !audit) {
        throw new Error('A resposta da IA veio incompleta. Tente novamente.');
      }

      let imported;
      if (result.status === 'parsed') {
        try {
          imported = await expensesApp.importStatement(result.rows, { owner, signal: request.signal, documentType: result.documentType });
        } catch {
          throw new Error('As despesas não puderam ser salvas neste navegador. Confira o armazenamento antes de tentar novamente.');
        }
      }
      if (pending !== request) return;
      currentFile = attachment;
      awaitingDetails = result.status === 'clarify';
      const answer = result.reply || (imported ? 'Leitura concluída.' : 'Confira o arquivo e tente novamente.');
      const turn = addTurn('assistant', answer);
      if (imported) {
        showImport(turn, imported, audit, conversation.signal, owner, result.documentType);
        log.scrollTop += turn.getBoundingClientRect().top - log.getBoundingClientRect().top - log.clientTop;
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
    fileInput.focus();
  });
  newConversation();

  return {
    endpoint,
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
