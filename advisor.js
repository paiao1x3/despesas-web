const advisorApp = (() => {
  const get = (id) => document.getElementById(id);
  const owner = get('advisor-owner');
  const period = get('advisor-period');
  const log = get('advisor-log');
  const prompts = get('advisor-prompts');
  const form = get('advisor-form');
  const input = get('advisor-question');
  const send = get('advisor-send');
  const clear = get('advisor-clear');
  const status = get('advisor-status');
  const setup = get('advisor-setup');
  const endpoint = statementAssistant.endpoint && new URL('/api/advisor', statementAssistant.endpoint).href;
  const historyKey = 'despesas.advisor.history.v1';
  const historyLimit = 6;
  const monthNames = 'janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro'.split(' ');
  const ignoredWords = new Set([
    ...monthNames,
    ...('agora ainda algum alguns analise assessor ate cada como com comparacao compare comparar compra compras das deles dentro desses dia dias dos entre essa esse esta este essas estes foi gastei gastamos gasto gastos gastando houve isso isto mais maior maiores media mesmo menores menos mensal meu meus minha minhas mes meses muda mudou nao nosso onde outro outros para passado passada paguei pagamentos pelo pelos pela pelas periodo pode por porque quais qual quando quanto recebi reais registrados resumo seja sim sobre tem tenha teve tivemos todos total totais uma valores ver veja ano anos despesa despesas categorias categoria lancamento lancamentos').split(' ')
  ]);
  let messages = [];
  let loaded = false;
  let pending;

  setup.hidden = Boolean(endpoint);
  form.hidden = !endpoint;

  function setStatus(text, isError = false) {
    status.textContent = text;
    status.classList.toggle('chatgpt-import-error', isError);
  }

  function render() {
    const turns = messages.map(({ role, text }) => {
      const turn = document.createElement('div');
      turn.className = 'statement-turn';
      turn.dataset.author = role;
      const author = document.createElement('strong');
      author.textContent = role === 'user' ? 'Você' : 'Assessor';
      const content = document.createElement('p');
      content.textContent = text;
      turn.append(author, content);
      return turn;
    });
    prompts.hidden = messages.length > 0;
    log.replaceChildren(prompts, ...turns);
    log.scrollTop = log.scrollHeight;
    clear.hidden = !messages.length;
  }

  function scopedHistoryKey() {
    return owner.value === 'all' ? historyKey : historyKey + '.' + owner.value;
  }

  function loadHistory() {
    try {
      const stored = JSON.parse(localStorage.getItem(scopedHistoryKey()) || '[]');
      return Array.isArray(stored) ? stored.filter((entry) =>
        ['user', 'assistant'].includes(entry?.role) && typeof entry.text === 'string'
      ).slice(-historyLimit).map(({ role, text }) => ({ role, text: text.slice(0, 1400) })) : [];
    } catch {
      return [];
    }
  }

  function saveHistory() {
    try {
      if (messages.length) localStorage.setItem(scopedHistoryKey(), JSON.stringify(messages));
      else localStorage.removeItem(scopedHistoryKey());
    } catch {
      setStatus('O histórico só pôde ser mantido nesta aba.', true);
    }
  }

  function syncPeriods(records) {
    const current = period.value;
    const months = [...new Set(records.map(({ date }) => date.slice(0, 7)))].sort().reverse();
    period.replaceChildren(new Option('Todos os meses', 'all'),
      ...months.map((month) => new Option(expensesApp.formatMonth(month), month)));
    period.value = months.includes(current) ? current : 'all';
  }

  function scopedRecords() {
    return expensesApp.readExpenses().filter((record) => owner.value === 'all' || record.owner === owner.value);
  }

  function refreshPeriods() {
    try {
      syncPeriods(scopedRecords());
    } catch {
      syncPeriods([]);
      setStatus('Não foi possível consultar os lançamentos.', true);
    }
  }

  function addTotal(map, key, cents) {
    const total = map.get(key) || { cents: 0, count: 0 };
    total.cents += cents;
    total.count++;
    map.set(key, total);
  }

  function asTriples(map) {
    return [...map].map(([name, { cents, count }]) => [name, cents, count]);
  }

  function buildContext(records, scope, question, previousQuestion) {
    const selected = records.filter(({ date }) => scope === 'all' || date.startsWith(scope + '-'));
    const byMonth = new Map();
    const byCategory = new Map();
    const categoriesByMonth = new Map();
    let totalCents = 0;
    for (const row of selected) {
      const month = row.date.slice(0, 7);
      addTotal(byMonth, month, row.cents);
      addTotal(byCategory, row.category, row.cents);
      if (!categoriesByMonth.has(month)) categoriesByMonth.set(month, new Map());
      addTotal(categoriesByMonth.get(month), row.category, row.cents);
      totalCents += row.cents;
    }
    const today = expensesApp.localDate();
    const thisMonth = today.slice(0, 7);
    const [year, month] = thisMonth.split('-').map(Number);
    const previousMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
    const monthly = asTriples(byMonth).sort(([first], [second]) => second.localeCompare(first));
    const periodMatches = (text) => {
      const normalized = expensesApp.normalizedWords(text);
      const tokens = new Set(normalized.split(' '));
      const years = new Set([...tokens].filter((token) => /^\d{4}$/.test(token)));
      const numbers = new Set(monthNames.flatMap((name, index) => tokens.has(name) ? [index + 1] : []));
      const exact = new Set([
        ...[...text.matchAll(/\b(\d{4})[-/](0[1-9]|1[0-2])\b/g)].map(([, year, month]) => year + '-' + month),
        ...[...text.matchAll(/\b(0[1-9]|1[0-2])\/(\d{4})\b/g)].map(([, month, year]) => year + '-' + month)
      ]);
      if (/\b(este mes|mes atual|nesse mes)\b/.test(normalized)) exact.add(thisMonth);
      if (/\b(mes passado|mes anterior)\b/.test(normalized)) exact.add(previousMonth);
      return monthly.map(([key]) => key).filter((key) => {
        if (exact.has(key)) return true;
        const [year, number] = key.split('-');
        return (numbers.size > 0 || (years.size > 0 && !exact.size)) &&
          (!years.size || years.has(year)) && (!numbers.size || numbers.has(Number(number)));
      });
    };
    const asked = periodMatches(question);
    const requested = asked.length || !previousQuestion ? asked : periodMatches(previousQuestion);
    const largestMonths = monthly.slice().sort((first, second) => second[1] - first[1]).slice(0, 3);
    const monthsToSend = new Set([...requested.slice(0, 24), ...largestMonths.map(([key]) => key),
      ...monthly.map(([key]) => key)].slice(0, 48));
    const termMatches = (text) => {
      const terms = [...new Set(expensesApp.normalizedWords(text).split(' '))]
        .filter((word) => (word === '99' || (word.length >= 3 && /[a-z]/.test(word))) && !ignoredWords.has(word));
      const matches = new Map(terms.map((term) => [term, { cents: 0, count: 0, months: new Map() }]));
      if (!matches.size) return [];
      for (const row of selected) {
        const words = new Set(expensesApp.normalizedWords(row.description + ' ' + row.category).split(' '));
        for (const word of words) {
          const found = matches.get(word);
          if (!found) continue;
          found.cents += row.cents;
          found.count++;
          addTotal(found.months, row.date.slice(0, 7), row.cents);
        }
      }
      return [...matches].sort((first, second) => Number(Boolean(second[1].count)) - Number(Boolean(first[1].count))).slice(0, 3)
        .map(([term, { cents, count, months }]) => ({
          term, cents, count, months: asTriples(months).filter(([key]) => monthsToSend.has(key))
            .sort(([first], [second]) => second.localeCompare(first)).slice(0, 24)
        }));
    };
    let matches = termMatches(question);
    if (!matches.length && previousQuestion) matches = termMatches(previousQuestion);
    const relevant = new Set(matches.map(({ term }) => term));
    const topCategories = (totals, limit) => asTriples(totals).sort((first, second) => {
      const mentioned = ([name]) => expensesApp.normalizedWords(name).split(' ').some((word) => relevant.has(word));
      return Number(mentioned(second)) - Number(mentioned(first)) || second[1] - first[1];
    }).slice(0, limit);
    const detailedMonths = [...new Set([...requested, ...monthly.map(([key]) => key)])].slice(0, 6);
    const wantsTransactions = /\b(?:maiores?|mais caras?|lancamentos|transacoes|itens)\b/.test(expensesApp.normalizedWords(question));
    const sample = wantsTransactions ? selected
      .filter(({ date }) => !requested.length || requested.includes(date.slice(0, 7)))
      .sort((first, second) => second.cents - first.cents)
      .slice(0, 6)
      .map(({ date, description, cents, category }) => [date, description.slice(0, 100), cents, category.slice(0, 40)]) : [];
    return {
      scope, person: owner.selectedOptions[0].textContent, today,
      totalCents, count: selected.length, monthCount: monthly.length,
      firstMonth: monthly.at(-1)?.[0], lastMonth: monthly[0]?.[0],
      months: monthly.filter(([key]) => monthsToSend.has(key)),
      categories: topCategories(byCategory, 12),
      monthCategories: detailedMonths.map((key) => [key, topCategories(categoriesByMonth.get(key), 6)]),
      matches, largestExamples: sample
    };
  }

  function setBusy(active) {
    send.disabled = active;
    input.readOnly = active;
    owner.disabled = active;
    period.disabled = active;
    clear.disabled = active;
  }

  prompts.addEventListener('click', (event) => {
    const question = event.target.closest('[data-question]')?.dataset.question;
    if (!question) return;
    input.value = question;
    input.focus();
  });

  clear.addEventListener('click', () => {
    messages = [];
    render();
    setStatus('Conversa limpa.');
    saveHistory();
    input.focus();
  });

  owner.addEventListener('change', () => {
    messages = loadHistory();
    setStatus('');
    refreshPeriods();
    render();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending || !endpoint) return;
    const question = input.value.trim();
    if (!question) {
      setStatus('Escreva uma pergunta para o assessor.', true);
      return;
    }
    const previousQuestion = messages.findLast(({ role }) => role === 'user')?.text || '';
    let data;
    try {
      const records = scopedRecords();
      syncPeriods(records);
      data = buildContext(records, period.value, question, previousQuestion);
    } catch {
      setStatus('Não foi possível consultar os lançamentos deste navegador.', true);
      return;
    }
    if (!data.count) {
      setStatus('Cadastre ou importe uma despesa para começar a análise.', true);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000);
    pending = controller;
    setBusy(true);
    setStatus('Analisando suas despesas…');
    try {
      const result = await fetch(endpoint, {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: messages.slice(-4), data })
      });
      const response = await result.json();
      if (!result.ok) throw new Error(response.error || 'O assessor está indisponível.');
      if (typeof response.answer !== 'string' || !response.answer.trim()) throw new Error('O assessor devolveu uma resposta vazia.');
      if (pending !== controller) return;
      messages = [...messages, { role: 'user', text: question }, { role: 'assistant', text: response.answer.slice(0, 1400) }]
        .slice(-historyLimit);
      form.reset();
      setStatus('');
      saveHistory();
      render();
    } catch (error) {
      if (pending !== controller) return;
      const text = controller.signal.aborted ? 'A análise demorou demais. Tente novamente.'
        : error instanceof TypeError ? 'Não foi possível se conectar ao assessor.' : error.message;
      setStatus(text, true);
    } finally {
      clearTimeout(timeout);
      if (pending === controller) {
        pending = undefined;
        setBusy(false);
      }
    }
  });

  return {
    open() {
      if (!loaded) messages = loadHistory();
      loaded = true;
      refreshPeriods();
      render();
    },
    close() {
      pending?.abort();
      pending = undefined;
      messages = [];
      loaded = false;
      owner.value = 'all';
      period.value = 'all';
      form.reset();
      setBusy(false);
      setStatus('');
      render();
    }
  };
})();
