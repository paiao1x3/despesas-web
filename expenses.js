const expensesApp = (() => {
  const storageKey = 'despesas.records.v1';
  const people = { joao: 'João', camille: 'Camille' };
  const defaultOwner = 'joao';
  const firstOwnerDeployment = Date.parse('2026-11-26T14:35:58Z');
  const newCategoryValue = 'new';
  const defaultCategories = [
    'Alimentação', 'Assinaturas', 'Compras', 'Educação', 'Lazer',
    'Moradia e contas', 'Saúde', 'Transporte', 'Outros'
  ];
  const maxCents = 999999999;
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
  const monthLabel = new Intl.DateTimeFormat('pt-BR', {
    month: 'long', year: 'numeric', timeZone: 'UTC'
  });
  const dateLabel = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });

  const get = (id) => document.getElementById(id);
  const account = get('account');
  const viewTitle = get('view-title');
  const navButtons = document.querySelectorAll('.app-nav [data-view]');
  const views = {
    dashboard: { title: 'Dashboard', panel: get('dashboard-view') },
    expenses: { title: 'Despesas', panel: get('expenses-view') },
    records: { title: 'Base de despesas', panel: get('records-view') },
    advisor: { title: 'Assessor', panel: get('advisor-view') }
  };
  const newExpense = get('new-expense');
  const period = get('period');
  const viewControls = get('view-controls');
  const dashboardOwnerFilter = get('dashboard-owner-filter');
  const dashboardOwner = get('dashboard-owner');
  const recordsSearch = get('records-search');
  const recordsOwner = get('records-owner');
  const recordsPeriod = get('records-period');
  const storageError = get('storage-error');
  const categoryFilter = get('category-filter');
  const expenseForm = get('expense-form');
  const expenseOwnerField = get('expense-owner-field');
  const expenseOwner = get('expense-owner');
  const description = get('expense-description');
  const amount = get('expense-amount');
  const date = get('expense-date');
  const category = get('expense-category');
  const customField = get('custom-category-field');
  const customCategory = get('custom-category');
  const expenseStatus = get('expense-status');
  const formTitle = get('expense-form-title');
  const saveButton = get('save-expense');
  const cancelButton = get('cancel-edit');

  let expenses = [];
  let activeOwner = defaultOwner;
  let editingId = null;

  function localDate() {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return today.getFullYear() + '-' + month + '-' + day;
  }

  function asUTC(isoDate) {
    return new Date(isoDate + 'T00:00:00Z');
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return false;
    const parsed = asUTC(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function toCents(value) {
    let normalized = value.trim();
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(normalized)) {
      normalized = normalized.replaceAll('.', '');
    }
    const parts = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(normalized);
    if (!parts) return 0;
    const cents = Number(parts[1]) * 100 + Number((parts[2] || '').padEnd(2, '0'));
    return cents > 0 && cents <= maxCents ? cents : 0;
  }

  function readExpenses() {
    const stored = localStorage.getItem(storageKey);
    const records = stored === null ? [] : JSON.parse(stored);
    if (!Array.isArray(records) || records.some((record) =>
      !record || typeof record.id !== 'string' || typeof record.description !== 'string' ||
      typeof record.category !== 'string' || !validDate(record.date) ||
      !Number.isSafeInteger(record.cents) || record.cents < 1 || record.cents > maxCents ||
      !Number.isFinite(record.createdAt) ||
      (record.owner !== undefined && !Object.hasOwn(people, record.owner))
    )) {
      throw new Error('Dados de despesas inválidos');
    }
    return records.map((record) => {
      // A primeira versão podia gravar João em lançamentos antigos durante outro salvamento.
      const inheritedOwner = record.owner === 'joao' && record.ownerConfirmed !== true &&
        record.createdAt < firstOwnerDeployment;
      return record.owner === undefined || inheritedOwner ? { ...record, owner: 'camille' } : record;
    });
  }

  function expenseId() {
    return crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
  }

  function withExpenseWrite(task) {
    return navigator.locks ? navigator.locks.request(storageKey, task) : Promise.resolve().then(task);
  }

  function showView(view, moveFocus = false) {
    const isExpenseView = Object.hasOwn(people, view);
    const panelKey = isExpenseView ? 'expenses' : view;
    for (const [key, { panel }] of Object.entries(views)) panel.hidden = key !== panelKey;
    if (isExpenseView && activeOwner !== view) {
      statementAssistant.close();
      activeOwner = view;
      resetForm();
      syncFilters(period.value, '');
      renderExpenses();
    }
    newExpense.hidden = view !== 'dashboard';
    dashboardOwnerFilter.hidden = view !== 'dashboard';
    viewControls.hidden = view === 'advisor' || view === 'records';
    viewTitle.textContent = isExpenseView ? 'Despesas de ' + people[view] : views[view].title;
    document.title = 'Despesas | ' + viewTitle.textContent;
    for (const button of navButtons) {
      if (button.dataset.view === view) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    }
    if (view === 'advisor') advisorApp.open();
    if (view === 'records') renderRecords();
    if (moveFocus) viewTitle.focus();
  }

  function categoryNames(owner = activeOwner) {
    const categories = expenses.filter((expense) => expense.owner === owner).map((expense) => expense.category);
    return [...new Set([...defaultCategories, ...categories])]
      .sort((first, second) => first.localeCompare(second, 'pt-BR'));
  }

  function categoryValue(name) {
    return 'category:' + name;
  }

  function syncCustomField() {
    const adding = category.value === newCategoryValue;
    customField.hidden = !adding;
    customCategory.required = adding;
  }

  function formatMonth(month) {
    return monthLabel.format(asUTC(month + '-01'));
  }

  function setMonthOptions(select, months, selected, fallback) {
    select.replaceChildren(
      ...[...months].sort().reverse().map((month) => new Option(formatMonth(month), month)),
      new Option('Todos os meses', 'all')
    );
    select.value = selected === 'all' || months.has(selected) ? selected : fallback;
  }

  function syncFilters(selectedPeriod, selectedCategory) {
    const current = localDate().slice(0, 7);
    const months = new Set([current, ...expenses.map((expense) => expense.date.slice(0, 7))]);
    setMonthOptions(recordsPeriod, months, recordsPeriod.value, 'all');
    if (selectedPeriod && selectedPeriod !== 'all') months.add(selectedPeriod);
    setMonthOptions(period, months, selectedPeriod, current);

    const names = categoryNames();
    const currentCategory = category.value;
    category.replaceChildren(
      new Option('Selecione uma categoria', ''),
      ...names.map((name) => new Option(name, categoryValue(name))),
      new Option('Nova categoria…', newCategoryValue)
    );
    category.value = Array.from(category.options).some((option) => option.value === currentCategory)
      ? currentCategory : '';
    syncCustomField();

    categoryFilter.replaceChildren(
      new Option('Todas', ''),
      ...names.map((name) => new Option(name, name))
    );
    categoryFilter.value = names.includes(selectedCategory) ? selectedCategory : '';
  }

  function recordsForPeriod(owner, selectedPeriod = period.value) {
    return expenses
      .filter((expense) =>
        (owner === 'all' || expense.owner === owner) &&
        (selectedPeriod === 'all' || expense.date.startsWith(selectedPeriod + '-'))
      )
      .sort((first, second) =>
        second.date.localeCompare(first.date) || second.createdAt - first.createdAt
      );
  }

  function element(tag, className = '', label = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = label;
    return node;
  }

  function recordAction(label, description, action, className = '') {
    const button = element('button', className, label);
    button.type = 'button';
    button.setAttribute('aria-label', label + ' ' + description);
    button.addEventListener('click', action);
    return button;
  }

  function expenseRow(expense, canEdit = false, showOwner = false) {
    const row = element('li', 'expense-row');
    const details = element('p', 'expense-details');
    const time = element('time', '', dateLabel.format(asUTC(expense.date)));
    time.dateTime = expense.date;
    details.append(time, element('span', 'expense-category-label', expense.category));
    if (showOwner) details.append(element('span', '', people[expense.owner]));
    row.append(
      element('strong', '', expense.description),
      element('span', 'expense-value', money.format(expense.cents / 100)),
      details
    );
    if (canEdit) {
      const actions = element('div', 'record-actions');
      actions.append(
        recordAction('Editar', expense.description, () => editExpense(expense)),
        recordAction('Excluir', expense.description, () => deleteExpense(expense), 'delete-expense')
      );
      row.append(actions);
    }
    return row;
  }

  function categoryRow(name, cents, total) {
    const row = element('li');
    const line = element('div', 'category-line');
    const value = element('span', 'category-value', money.format(cents / 100) + ' ');
    value.append(element('span', 'category-share', percent.format(cents / total)));
    line.append(element('span', 'category-name', name), value);
    const track = element('div', 'category-bar');
    track.setAttribute('aria-hidden', 'true');
    const fill = element('span');
    fill.style.width = (cents / total) * 100 + '%';
    track.append(fill);
    row.append(line, track);
    return row;
  }

  function renderExpenses() {
    const visible = recordsForPeriod(activeOwner)
      .filter((expense) => !categoryFilter.value || expense.category === categoryFilter.value);
    get('expense-list').replaceChildren(...visible.map((expense) => expenseRow(expense, true)));
    const empty = get('expenses-empty');
    empty.hidden = visible.length > 0;
    empty.textContent = categoryFilter.value
      ? 'Nenhuma despesa nesta categoria para o período selecionado.'
      : 'Nenhuma despesa neste período.';
  }

  function renderDashboard() {
    const records = recordsForPeriod(dashboardOwner.value);
    const totals = new Map();
    let total = 0;
    for (const expense of records) {
      total += expense.cents;
      totals.set(expense.category, (totals.get(expense.category) || 0) + expense.cents);
    }
    const ranked = [...totals].sort(([firstName, firstCents], [secondName, secondCents]) =>
      secondCents - firstCents || firstName.localeCompare(secondName, 'pt-BR')
    );
    get('total-spending').textContent = money.format(total / 100);
    get('expense-count').textContent = records.length.toLocaleString('pt-BR');
    get('top-category').textContent = ranked[0]?.[0] || '—';
    get('category-list').replaceChildren(...ranked.map(([name, cents]) => categoryRow(name, cents, total)));
    get('categories-empty').hidden = records.length > 0;
    get('recent-list').replaceChildren(...records.slice(0, 5)
      .map((expense) => expenseRow(expense, false, dashboardOwner.value === 'all')));
    get('recent-empty').hidden = records.length > 0;
  }

  function renderRecords() {
    const query = normalizedWords(recordsSearch.value);
    const rows = recordsForPeriod(recordsOwner.value, recordsPeriod.value)
      .filter((expense) => !query || normalizedWords(expense.description).includes(query) ||
        normalizedWords(expense.category).includes(query));
    const total = rows.reduce((sum, expense) => sum + expense.cents, 0);
    const count = rows.length.toLocaleString('pt-BR') + (rows.length === 1 ? ' lançamento' : ' lançamentos');
    get('records-summary').textContent = count + ' · ' + money.format(total / 100);

    const fragment = document.createDocumentFragment();
    for (const expense of rows) {
      const row = element('tr');
      const dateCell = element('td');
      const time = element('time', '', dateLabel.format(asUTC(expense.date)));
      time.dateTime = expense.date;
      dateCell.append(time);
      const action = element('td', 'records-action');
      action.append(recordAction('Editar', expense.description, () => {
        showView(expense.owner);
        editExpense(expense);
      }, 'quiet-button'));
      row.append(element('td', 'records-description', expense.description),
        element('td', 'expense-value', money.format(expense.cents / 100)), dateCell,
        element('td', '', people[expense.owner]), element('td', '', expense.category), action);
      fragment.append(row);
    }
    get('records-body').replaceChildren(fragment);
    get('records-table').hidden = rows.length === 0;
    const empty = get('records-empty');
    empty.hidden = rows.length > 0;
    empty.textContent = expenses.length ? 'Nenhum lançamento corresponde aos filtros.' : 'Nenhuma despesa cadastrada.';
  }

  function render() {
    renderDashboard();
    renderExpenses();
    if (!views.records.panel.hidden) renderRecords();
  }

  function setStatus(message, isError = false) {
    expenseStatus.dataset.error = String(isError);
    expenseStatus.textContent = message;
  }

  function resetForm() {
    editingId = null;
    expenseForm.reset();
    expenseOwner.value = activeOwner;
    expenseOwnerField.hidden = true;
    date.value = localDate();
    category.value = '';
    syncCustomField();
    formTitle.textContent = 'Registrar despesa';
    saveButton.textContent = 'Salvar despesa';
    cancelButton.hidden = true;
    setStatus('');
  }

  function editExpense(expense) {
    editingId = expense.id;
    expenseOwner.value = expense.owner;
    expenseOwnerField.hidden = false;
    description.value = expense.description;
    amount.value = (expense.cents / 100).toFixed(2).replace('.', ',');
    date.value = expense.date;
    category.value = categoryValue(expense.category);
    customCategory.value = '';
    syncCustomField();
    formTitle.textContent = 'Editar despesa';
    saveButton.textContent = 'Salvar alterações';
    cancelButton.hidden = false;
    setStatus('');
    description.focus();
  }

  function refresh(selectedPeriod = period.value, selectedCategory = categoryFilter.value) {
    try {
      expenses = readExpenses();
      storageError.hidden = true;
    } catch {
      storageError.textContent = 'Não foi possível carregar as despesas armazenadas neste navegador.';
      storageError.hidden = false;
    }
    syncFilters(selectedPeriod, selectedCategory);
    render();
  }

  async function writeChanges(id, update, mustExist) {
    try {
      return await withExpenseWrite(() => {
        const latest = readExpenses();
        const existing = latest.find((expense) => expense.id === id);
        if (mustExist && !existing) {
          expenses = latest;
          syncFilters(period.value, categoryFilter.value);
          render();
          setStatus('Este lançamento não está mais disponível.', true);
          return false;
        }
        const next = latest.filter((expense) => expense.id !== id);
        if (update) next.push({ ...existing, ...update, createdAt: existing?.createdAt ?? Date.now() });
        localStorage.setItem(storageKey, JSON.stringify(next));
        expenses = next;
        storageError.hidden = true;
        return true;
      });
    } catch {
      setStatus('Não foi possível salvar a alteração neste navegador.', true);
      return false;
    }
  }

  async function deleteExpense(expense) {
    if (!window.confirm('Excluir a despesa “' + expense.description + '”?')) return;
    if (!await writeChanges(expense.id, null, true)) return;
    syncFilters(period.value, categoryFilter.value);
    render();
    if (activeOwner === expense.owner && !views.expenses.panel.hidden) {
      if (editingId === expense.id) resetForm();
      setStatus('Despesa excluída.');
      get('expense-list-title').focus();
    }
  }

  expenseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saveButton.disabled) return;
    const label = description.value.trim();
    const cents = toCents(amount.value);
    const sourceOwner = activeOwner;
    const owner = editingId ? expenseOwner.value : sourceOwner;

    if (!label) {
      setStatus('Informe uma descrição para a despesa.', true);
      description.focus();
      return;
    }
    if (!cents) {
      setStatus('Informe um valor entre R$ 0,01 e R$ 9.999.999,99, com até duas casas decimais.', true);
      amount.focus();
      return;
    }
    if (!validDate(date.value)) {
      setStatus('Informe uma data válida.', true);
      date.focus();
      return;
    }

    let name = category.value.slice('category:'.length);
    if (category.value === newCategoryValue) {
      const customName = customCategory.value.trim();
      if (!customName) {
        setStatus('Informe o nome da nova categoria.', true);
        customCategory.focus();
        return;
      }
      name = categoryNames(owner).find((item) => item.localeCompare(customName, 'pt-BR', { sensitivity: 'base' }) === 0)
        || customName;
    }

    const id = editingId || expenseId();
    const updated = { id, description: label, category: name, date: date.value, cents, owner, ownerConfirmed: true };
    const moved = owner !== sourceOwner;
    const message = moved ? 'Despesa movida para ' + people[owner] + '.'
      : editingId ? 'Despesa atualizada.' : 'Despesa registrada.';
    saveButton.disabled = true;
    const saved = await writeChanges(id, updated, Boolean(editingId));
    saveButton.disabled = false;
    if (!saved) return;
    if (activeOwner !== sourceOwner) {
      syncFilters(period.value, categoryFilter.value);
      render();
      return;
    }

    const visibleMonth = period.value === 'all' ? 'all' : updated.date.slice(0, 7);
    const visibleCategory = categoryFilter.value === name ? name : '';
    if (moved && !views.expenses.panel.hidden) showView(owner);
    else resetForm();
    syncFilters(visibleMonth, visibleCategory);
    setStatus(message);
    render();
    description.focus();
  });

  for (const button of navButtons) {
    button.addEventListener('click', () => showView(button.dataset.view, true));
  }
  newExpense.addEventListener('click', () => {
    showView(dashboardOwner.value === 'all' ? activeOwner : dashboardOwner.value);
    description.focus();
  });
  period.addEventListener('change', render);
  dashboardOwner.addEventListener('change', renderDashboard);
  recordsSearch.addEventListener('input', renderRecords);
  recordsOwner.addEventListener('change', renderRecords);
  recordsPeriod.addEventListener('change', renderRecords);
  categoryFilter.addEventListener('change', renderExpenses);
  category.addEventListener('change', syncCustomField);
  cancelButton.addEventListener('click', () => {
    resetForm();
    description.focus();
  });
  window.addEventListener('storage', (event) => {
    if (!account.hidden && (event.key === storageKey || event.key === null)) refresh();
  });

  function normalizedWords(text) {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function sameExpense(candidate, known, reference) {
    const original = known.statementSource;
    const name = comparableDescription(candidate.description);
    return [known, original].some((row) => {
      if (!row || row.cents !== candidate.cents) return false;
      const daysApart = Math.abs(asUTC(row.date) - asUTC(candidate.date)) / 86400000;
      if (reference && reference === original?.reference && daysApart <= 3) return true;
      if (daysApart > 1) return false;
      const knownName = comparableDescription(row.description);
      if (!name || !knownName) return false;
      if (name.replaceAll(' ', '') === knownName.replaceAll(' ', '')) return true;
      if (daysApart !== 0) return false;
      const [shorter, longer] = [name, knownName].sort((first, second) => first.length - second.length);
      return shorter.length >= 5 && (' ' + longer + ' ').includes(' ' + shorter + ' ');
    });
  }

  function comparableDescription(text) {
    const normalized = normalizedWords(text);
    // Bancos e leitores podem incluir o tipo de pagamento no nome da compra.
    return normalized.replace(/\b(?:pix|debito|compra|pagamento|cartao|efetuado|realizado)\b/g, ' ')
      .replace(/\s+/g, ' ').trim().replace(/^(?:(?:p|para|de|via|em|no|na|ao) )+/, '') || normalized;
  }

  function isCardBillSummary(description, documentType) {
    const words = normalizedWords(description);
    const payment = /\b(?:pagamento|pagto|pagt|pgto|pgt|pag|liquidacao|quitacao|debito|deb aut(?:o)?)\b/;
    const [beforeBill, afterBill] = words.split(/\bfatura\b/, 2).map((part) => part.trim());
    if (afterBill !== undefined) {
      const cardDetail = /^(?:(?:d[eo] )?(?:cartao|cartoes|credito|itau|nubank|bradesco|santander|inter|credicard|visa|mastercard|amex)|bb ourocard|caixa cartoes)\b/;
      const genericDetail = /^(?:(?:do mes|mensal|atual|anterior|vencida|paga|quitada|liquidada|via pix|por pix|por boleto|em debito automatico) *)*(?:\d[\d ]*)?$/;
      const paid = payment.test(beforeBill) || /^(?:paga|quitada|liquidada)\b/.test(afterBill);
      const summary = /^(?:total|valor|saldo)(?: (?:da|de))?$/.test(beforeBill);
      if ((paid || summary) && (cardDetail.test(afterBill) || genericDetail.test(afterBill))) return true;
      if (!beforeBill && cardDetail.test(afterBill)) return true;
    }

    // Uma despesa paga com cartão é diferente de um pagamento feito ao emissor do cartão.
    if (/^(?:pagamento|pagto|pgto|pagt|pgt|pag) (?:d[eo] )?cartao(?: (?:de )?credito)?(?: \d[\d ]*)?$/.test(words)) return true;
    if (/^pagamento recebido(?: obrigad[oa])?$/.test(words)) return true;
    if (documentType !== 'fatura') return false;
    return /^(?:pagamento|pagto|pgto|pag)(?: (?:recebido|efetuado|realizado|confirmado|registrado|processado|automatico|on line|online|em dinheiro|via pix|por pix|pix|obrigad[oa]))*(?: \d[\d ]*)?$/.test(words) ||
      /^(?:credito (?:de |do )?pagamento|debito automatico|saldo anterior|total (?:geral|a pagar)|valor a pagar|pagamento minimo)$/.test(words);
  }

  async function importStatement(rows, { owner = activeOwner, force = false, signal, documentType } = {}) {
    if (!Array.isArray(rows) || rows.length > 60) throw new Error('A leitura devolveu uma lista inválida.');
    if (!Object.hasOwn(people, owner)) throw new Error('Pessoa inválida para a importação.');
    const result = await withExpenseWrite(() => {
      if (signal?.aborted) throw signal.reason;
      const latest = readExpenses();
      const personal = latest.filter((expense) => expense.owner === owner);
      const categories = [...defaultCategories, ...personal.map((expense) => expense.category)];
      const added = [];
      const duplicates = [];
      const invalid = [];
      const excluded = [];
      for (const [index, row] of rows.entries()) {
        const rawDescription = typeof row?.description === 'string' ? row.description.trim() : '';
        const label = rawDescription.slice(0, 100);
        const line = { description: label || 'Linha ' + (index + 1), date: row?.date, cents: row?.cents };
        if (isCardBillSummary(rawDescription, documentType)) {
          excluded.push({ ...line, reason: 'Pagamento ou total da fatura do cartão.' });
          continue;
        }
        const issues = [];
        if (!label) issues.push('descrição ausente');
        if (!validDate(line.date)) issues.push('data ausente ou inválida');
        if (!Number.isSafeInteger(line.cents) || line.cents < 1 || line.cents > maxCents) issues.push('valor inválido para uma despesa em reais');
        if (issues.length) {
          invalid.push({ ...line, reason: 'Confira os dados da linha (' + issues.join(', ') + ').' });
          continue;
        }
        const category = categories.find((name) => name === row.category) || 'Outros';
        const candidate = { description: label, date: row.date, cents: row.cents, category };
        const reference = typeof row.reference === 'string'
          ? normalizedWords(row.reference.slice(0, 100)).replaceAll(' ', '') : '';
        const matching = !force && (personal.find((known) => sameExpense(candidate, known, reference))
          || added.find((known) => sameExpense(candidate, known, reference)));
        if (matching) {
          duplicates.push({ row: { ...candidate, reference }, matching });
          continue;
        }
        const { date, cents, description } = candidate;
        added.push({ ...candidate, owner, ownerConfirmed: true, id: expenseId(), createdAt: Date.now(),
          statementSource: { date, cents, description, reference } });
      }
      const next = [...latest, ...added];
      if (added.length) localStorage.setItem(storageKey, JSON.stringify(next));
      expenses = next;
      return { added, duplicates, invalid, excluded };
    });
    storageError.hidden = true;
    const { added } = result;
    const months = new Set(added.map((expense) => expense.date.slice(0, 7)));
    const visibleMonth = months.size === 1 && period.value !== 'all' ? [...months][0] : 'all';
    const changedCurrentOwner = owner === activeOwner && added.length > 0;
    syncFilters(changedCurrentOwner ? visibleMonth : period.value, changedCurrentOwner ? '' : categoryFilter.value);
    render();
    return result;
  }

  return {
    categoryNames,
    getExpenseOwner: () => activeOwner,
    importStatement,
    readExpenses,
    formatMonth,
    localDate,
    normalizedWords,
    formatExpense({ description, date, cents, category }) {
      const details = [description];
      if (validDate(date)) details.push(dateLabel.format(asUTC(date)));
      if (Number.isSafeInteger(cents)) details.push(money.format(cents / 100));
      if (category) details.push(category);
      return details.join(' · ');
    },
    open() {
      activeOwner = defaultOwner;
      dashboardOwner.value = 'all';
      recordsSearch.value = '';
      recordsOwner.value = 'all';
      recordsPeriod.value = 'all';
      showView('dashboard');
      refresh('', '');
      resetForm();
    }
  };
})();
