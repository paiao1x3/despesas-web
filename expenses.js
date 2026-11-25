const expensesApp = (() => {
  const storageKey = 'despesas.records.v1';
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
    advisor: { title: 'Assessor', panel: get('advisor-view') }
  };
  const newExpense = get('new-expense');
  const period = get('period');
  const viewControls = get('view-controls');
  const storageError = get('storage-error');
  const categoryFilter = get('category-filter');
  const expenseForm = get('expense-form');
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
      !Number.isFinite(record.createdAt)
    )) {
      throw new Error('Dados de despesas inválidos');
    }
    return records;
  }

  function expenseId() {
    return crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
  }

  function withExpenseWrite(task) {
    return navigator.locks ? navigator.locks.request(storageKey, task) : Promise.resolve().then(task);
  }

  function showView(view, moveFocus = false) {
    for (const [key, { panel }] of Object.entries(views)) panel.hidden = key !== view;
    newExpense.hidden = view !== 'dashboard';
    viewControls.hidden = view === 'advisor';
    viewTitle.textContent = views[view].title;
    document.title = 'Despesas | ' + viewTitle.textContent;
    for (const button of navButtons) {
      if (button.dataset.view === view) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    }
    if (view === 'advisor') advisorApp.open();
    if (moveFocus) viewTitle.focus();
  }

  function categoryNames() {
    return [...new Set([...defaultCategories, ...expenses.map((expense) => expense.category)])]
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

  function syncFilters(selectedPeriod, selectedCategory) {
    const current = localDate().slice(0, 7);
    const months = new Set([current, ...expenses.map((expense) => expense.date.slice(0, 7))]);
    if (selectedPeriod && selectedPeriod !== 'all') months.add(selectedPeriod);
    const monthOptions = [...months].sort().reverse().map((month) =>
      new Option(formatMonth(month), month)
    );
    period.replaceChildren(...monthOptions, new Option('Todos os meses', 'all'));
    period.value = selectedPeriod || current;

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

  function recordsForPeriod() {
    return expenses
      .filter((expense) => period.value === 'all' || expense.date.startsWith(period.value + '-'))
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

  function expenseRow(expense, canEdit = false) {
    const row = element('li', 'expense-row');
    const details = element('p', 'expense-details');
    const time = element('time', '', dateLabel.format(asUTC(expense.date)));
    time.dateTime = expense.date;
    details.append(time, element('span', 'expense-category-label', expense.category));
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

  function renderExpenses(records) {
    const visible = records.filter((expense) => !categoryFilter.value || expense.category === categoryFilter.value);
    get('expense-list').replaceChildren(...visible.map((expense) => expenseRow(expense, true)));
    const empty = get('expenses-empty');
    empty.hidden = visible.length > 0;
    empty.textContent = categoryFilter.value
      ? 'Nenhuma despesa nesta categoria para o período selecionado.'
      : 'Nenhuma despesa neste período.';
  }

  function render() {
    const records = recordsForPeriod();
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
    get('recent-list').replaceChildren(...records.slice(0, 5).map((expense) => expenseRow(expense)));
    get('recent-empty').hidden = records.length > 0;
    renderExpenses(records);
  }

  function setStatus(message, isError = false) {
    expenseStatus.dataset.error = String(isError);
    expenseStatus.textContent = message;
  }

  function resetForm() {
    editingId = null;
    expenseForm.reset();
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
    if (editingId === expense.id) resetForm();
    setStatus('Despesa excluída.');
    syncFilters(period.value, categoryFilter.value);
    render();
    get('expense-list-title').focus();
  }

  expenseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saveButton.disabled) return;
    const label = description.value.trim();
    const cents = toCents(amount.value);

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
      name = categoryNames().find((item) => item.localeCompare(customName, 'pt-BR', { sensitivity: 'base' }) === 0)
        || customName;
    }

    const id = editingId || expenseId();
    const updated = { id, description: label, category: name, date: date.value, cents };
    const message = editingId ? 'Despesa atualizada.' : 'Despesa registrada.';
    saveButton.disabled = true;
    const saved = await writeChanges(id, updated, Boolean(editingId));
    saveButton.disabled = false;
    if (!saved) return;

    const visibleMonth = period.value === 'all' ? 'all' : updated.date.slice(0, 7);
    const visibleCategory = categoryFilter.value === name ? name : '';
    resetForm();
    syncFilters(visibleMonth, visibleCategory);
    setStatus(message);
    render();
    description.focus();
  });

  for (const button of navButtons) {
    button.addEventListener('click', () => showView(button.dataset.view, true));
  }
  newExpense.addEventListener('click', () => {
    showView('expenses');
    description.focus();
  });
  period.addEventListener('change', render);
  categoryFilter.addEventListener('change', () => renderExpenses(recordsForPeriod()));
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

  async function importStatement(rows, { force = false, signal } = {}) {
    if (!Array.isArray(rows) || rows.length > 60) throw new Error('A leitura devolveu uma lista inválida.');
    const { added, duplicates, invalid } = await withExpenseWrite(() => {
      if (signal?.aborted) throw signal.reason;
      const latest = readExpenses();
      const categories = [...defaultCategories, ...latest.map((expense) => expense.category)];
      const added = [];
      const duplicates = [];
      let invalid = 0;
      for (const row of rows) {
        const label = typeof row?.description === 'string' ? row.description.trim().slice(0, 100) : '';
        if (!label || !validDate(row.date) || !Number.isSafeInteger(row.cents) || row.cents < 1 || row.cents > maxCents) {
          invalid++;
          continue;
        }
        const category = categories.find((name) => name === row.category) || 'Outros';
        const candidate = { description: label, date: row.date, cents: row.cents, category };
        const reference = typeof row.reference === 'string'
          ? normalizedWords(row.reference.slice(0, 100)).replaceAll(' ', '') : '';
        const matching = !force && (latest.find((known) => sameExpense(candidate, known, reference))
          || added.find((known) => sameExpense(candidate, known, reference)));
        if (matching) {
          duplicates.push({ row: { ...candidate, reference }, matching });
          continue;
        }
        const { date, cents, description } = candidate;
        added.push({ ...candidate, id: expenseId(), createdAt: Date.now(),
          statementSource: { date, cents, description, reference } });
      }
      const next = [...latest, ...added];
      if (added.length) localStorage.setItem(storageKey, JSON.stringify(next));
      expenses = next;
      return { added, duplicates, invalid };
    });
    storageError.hidden = true;
    const months = new Set(added.map((expense) => expense.date.slice(0, 7)));
    const visibleMonth = months.size === 1 && period.value !== 'all' ? [...months][0] : 'all';
    syncFilters(added.length ? visibleMonth : period.value, added.length ? '' : categoryFilter.value);
    render();
    return { added, duplicates, invalid };
  }

  return {
    categoryNames,
    importStatement,
    readExpenses,
    formatMonth,
    localDate,
    normalizedWords,
    formatExpense(expense) {
      return expense.description + ' · ' + dateLabel.format(asUTC(expense.date)) + ' · ' + money.format(expense.cents / 100);
    },
    open() {
      showView('dashboard');
      refresh('', '');
      resetForm();
    }
  };
})();
