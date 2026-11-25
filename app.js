const form = document.querySelector('#resume-form');
const status = document.querySelector('#status');
const preview = document.querySelector('#preview');
const frame = preview.querySelector('iframe');
const addButtons = [...document.querySelectorAll('[data-add]')];
const rowLimit = 30;
const formatSelect = form.elements.namedItem('format');
const fields = ['format', 'company', 'name', 'role', 'location', 'contactNote', 'email', 'phone', 'links', 'profile'];
const fieldControl = field => form.querySelector(`[name="${field}"]`);
const importKeys = new Map([
  ['name', 'name'], ['role', 'role'], ['location', 'location'], ['contactnote', 'contactNote'],
  ['email', 'email'], ['phone', 'phone'], ['link', 'links'], ['profile', 'profile'],
  ['introduction', 'profile'],
]);
const rowKeys = new Map([
  ['education', new Map([['title', 'title'], ['school', 'organization'], ['location', 'location'], ['dates', 'period'], ['highlight', 'highlights']])],
  ['skills', new Map([['group', 'group'], ['skill', 'items']])],
  ['experience', new Map([['title', 'title'], ['employer', 'organization'], ['location', 'location'], ['dates', 'period'], ['highlight', 'highlights']])],
  ['projects', new Map([['title', 'title'], ['technologies', 'technologies'], ['dates', 'period'], ['highlight', 'highlights']])],
]);
const multilineFields = new Set(['role', 'links', 'profile', 'items', 'highlights']);
let previewUrl;

function importDetails(source) {
  const values = new Map();
  const groups = new Map();
  let section = 'details';
  let current;

  function finishRow() {
    if (!current) return;
    const requiredField = section === 'skills' ? 'items' : 'title';
    const requiredKey = section === 'skills' ? 'skill' : 'title';
    if (!current.values.has(requiredField)) {
      throw new Error(`Line ${current.line}: [${section}] needs at least one "${requiredKey}" line.`);
    }
    groups.get(section).push(current.values);
    current = undefined;
  }

  const lines = source.split(/\r\n?|\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const prefix = `Line ${index + 1}:`;
    if (trimmed.startsWith('[')) {
      finishRow();
      section = /^\[(\w+)\]$/.exec(trimmed.toLowerCase())?.[1];
      if (section === 'details') continue;
      if (!rowKeys.has(section)) throw new Error(`${prefix} expected [details], [education], [skills], [experience], or [projects].`);
      if (!groups.has(section)) groups.set(section, []);
      if (groups.get(section).length >= rowLimit) throw new Error(`${prefix} [${section}] accepts at most ${rowLimit} entries.`);
      current = { values: new Map(), line: index + 1 };
      continue;
    }

    const separator = line.indexOf(':');
    if (separator < 0) throw new Error(`${prefix} expected key: value.`);
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (section === 'details' && key === 'project') {
      if (!value || value.length > 250) throw new Error(`${prefix} "project" needs a name of at most 250 characters.`);
      if (!groups.has('projects')) groups.set('projects', []);
      if (groups.get('projects').length >= rowLimit) throw new Error(`${prefix} [projects] accepts at most ${rowLimit} entries.`);
      groups.get('projects').push(new Map([['title', value]]));
      continue;
    }
    const field = (current ? rowKeys.get(section) : importKeys).get(key);
    if (!field) throw new Error(`${prefix} unknown key "${key}" in [${section}].`);
    if (!value) throw new Error(`${prefix} "${key}" needs a value.`);
    const target = current?.values ?? values;
    if (target.has(field) && !multilineFields.has(field)) throw new Error(`${prefix} duplicate key "${key}".`);
    const control = current ? rowTemplate(section).content.querySelector(`[name="${field}"]`) : fieldControl(field);
    const combined = target.has(field) ? `${target.get(field)}\n${value}` : value;
    if (combined.length > control.maxLength) {
      throw new Error(`${prefix} "${key}" exceeds ${control.maxLength} characters.`);
    }
    if (key === 'email') {
      const email = control.cloneNode();
      email.value = value;
      if (!email.validity.valid) throw new Error(`${prefix} enter a valid email address.`);
    }
    target.set(field, combined);
  }
  finishRow();
  if (!values.size && !groups.size) throw new Error('Paste at least one key: value line.');

  for (const [field, value] of values) fieldControl(field).value = value;
  for (const button of addButtons) {
    const name = button.dataset.add;
    if (!groups.has(name)) continue;
    replaceRows(button, groups.get(name));
  }
  const count = values.size + [...groups.values()].reduce((total, rows) => total + rows.length, 0);
  return count;
}

const importText = document.querySelector('#import-text');
const importStatus = document.querySelector('#import-status');
const promptText = document.querySelector('#ai-prompt-text');
const copyStatus = document.querySelector('#copy-status');
const copyButton = document.querySelector('#copy-prompt');
let copyReset;
copyButton.addEventListener('click', async () => {
  clearTimeout(copyReset);
  copyButton.disabled = true;
  copyButton.classList.remove('is-copied');
  copyStatus.textContent = '';
  try {
    await navigator.clipboard.writeText(promptText.textContent);
    copyButton.classList.add('is-copied');
    copyStatus.textContent = 'Prompt copied.';
    copyReset = setTimeout(() => {
      copyButton.classList.remove('is-copied');
      copyStatus.textContent = '';
    }, 1800);
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(promptText);
    selection.removeAllRanges();
    selection.addRange(range);
    copyStatus.textContent = 'Automatic copying is unavailable. The prompt is selected; press Ctrl+C to copy it.';
  } finally {
    copyButton.disabled = false;
  }
});

function setBusy(button, busy) {
  button.disabled = busy;
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}

const importButton = document.querySelector('#import-details');
const importPanel = importButton.closest('details');
importButton.addEventListener('click', async () => {
  const source = importText.value;
  setBusy(importButton, true);
  importStatus.classList.remove('error');
  importStatus.textContent = 'Importing details\u2026';
  try {
    // Let the browser paint the busy state before parsing and updating the form.
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const count = importDetails(source);
    importStatus.textContent = `Imported ${count} ${count === 1 ? 'field or entry' : 'fields and entries'}. Unlisted fields and sections were unchanged.`;
    importPanel.open = false;
    importPanel.querySelector('summary').focus();
  } catch (error) {
    importStatus.classList.add('error');
    importStatus.textContent = error.message;
  } finally {
    setBusy(importButton, false);
  }
});

function readPhoto(file) {
  if (!file?.size) return '';
  if (file.size > 5_000_000) throw new Error('Choose a photo smaller than 5 MB.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP photo.');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result), { once: true });
    reader.addEventListener('error', () => reject(new Error('Could not read the selected photo.')), { once: true });
    reader.readAsDataURL(file);
  });
}

function rowTemplate(section) {
  return document.getElementById(section === 'education' || section === 'experience' ? 'entry-template' : `${section}-template`);
}

function applyVisibility(root) {
  for (const element of root.querySelectorAll('[data-formats]')) {
    element.hidden = !element.dataset.formats.split(' ').includes(formatSelect.value);
  }
}

function updateFormat() {
  const reference = formatSelect.value === 'reference';
  const skills = document.querySelector('#skills-fields');
  const experience = document.querySelector('#experience-fields');
  if (reference) experience.before(skills);
  else document.querySelector('#projects').closest('fieldset').after(skills);
  document.querySelector('#skills-legend').textContent = reference ? '05 / Skills' : '07 / Technical Skills';
  document.querySelector('#experience-legend').textContent = reference ? '06 / Experience' : '05 / Work Experience';
  applyVisibility(form);
}

function createRow(button, values = []) {
  const section = button.dataset.add;
  const row = rowTemplate(section).content.firstElementChild.cloneNode(true);
  if (section === 'education' || section === 'experience') {
    const education = section === 'education';
    row.querySelector('[data-label="title"]').textContent = education ? 'Degree or program' : 'Job title';
    row.querySelector('[data-label="organization"]').textContent = education ? 'School' : 'Employer';
  }
  for (const [field, value] of values) row.querySelector(`[name="${field}"]`).value = value;
  applyVisibility(row);
  row.querySelector('[data-remove]').addEventListener('click', () => {
    row.remove();
    button.disabled = false;
    button.focus();
  });
  return row;
}

function replaceRows(button, rows) {
  document.getElementById(button.dataset.add).replaceChildren(...rows.map(row => createRow(button, row)));
  button.disabled = rows.length >= rowLimit;
}

function readRows(button, visibleOnly = false) {
  return [...document.getElementById(button.dataset.add).children].map(row =>
    Object.fromEntries([...row.querySelectorAll('[name]')].filter(control => !visibleOnly || !control.closest('[hidden]'))
      .map(control => [control.name, control.value])));
}

formatSelect.addEventListener('change', updateFormat);
updateFormat();

for (const button of addButtons) {
  const section = button.dataset.add;
  const rows = document.getElementById(section);
  button.addEventListener('click', () => {
    const row = createRow(button);
    rows.append(row);
    button.disabled = rows.children.length >= rowLimit;
    row.querySelector('input').focus();
  });
}

const draftKey = 'resume-maker:draft:v1';
const draftButton = document.querySelector('#save-draft');
const draftStatus = document.querySelector('#draft-status');

function draftMessage(message, error = false) {
  draftStatus.classList.toggle('error', error);
  draftStatus.textContent = message;
}

draftButton.addEventListener('click', async () => {
  setBusy(draftButton, true);
  draftMessage('Saving draft\u2026');
  try {
    const values = Object.fromEntries(fields.map(field => [field, fieldControl(field).value]));
    const sections = Object.fromEntries(addButtons.map(button => [button.dataset.add, readRows(button)]));
    const photo = await readPhoto(fieldControl('photo').files[0]);
    localStorage.setItem(draftKey, JSON.stringify({ values, sections, photo }));
    draftMessage('Draft saved in this browser.');
  } catch (error) {
    const reason = error.name === 'QuotaExceededError' ? 'Browser storage is full. Try a smaller photo.' : error.message;
    draftMessage(`Could not save the draft. ${reason}`, true);
  } finally {
    setBusy(draftButton, false);
  }
});

try {
  const stored = localStorage.getItem(draftKey);
  if (stored !== null) {
    const { values, sections, photo } = JSON.parse(stored);
    if (!values || !sections || typeof photo !== 'string' ||
        fields.some(field => typeof values[field] !== 'string') ||
        ![...formatSelect.options].some(option => option.value === values.format)) {
      throw new Error('The saved draft has an invalid format.');
    }
    const files = new DataTransfer();
    if (photo) {
      const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(photo);
      if (!match) throw new Error('The saved photo is invalid.');
      files.items.add(new File([Uint8Array.from(atob(match[2]), char => char.charCodeAt(0))],
        `draft-photo.${match[1].split('/')[1]}`, { type: match[1] }));
    }
    const savedRows = addButtons.map(button => {
      const section = button.dataset.add;
      const rows = sections[section];
      const keys = [...rowTemplate(section).content.querySelectorAll('[name]')].map(control => control.name);
      if (!Array.isArray(rows) || rows.length > rowLimit ||
          rows.some(row => !row || keys.some(key => typeof row[key] !== 'string'))) {
        throw new Error(`The saved ${section} entries are invalid.`);
      }
      return [button, rows.map(row => keys.map(key => [key, row[key]]))];
    });
    for (const field of fields) fieldControl(field).value = values[field];
    fieldControl('photo').files = files.files;
    for (const [button, rows] of savedRows) replaceRows(button, rows);
    updateFormat();
    draftMessage('Local draft restored.');
  }
} catch (error) {
  draftMessage(`Could not restore the local draft. ${error.message}`, true);
}

document.querySelector('#close-preview').addEventListener('click', () => preview.close());
preview.addEventListener('close', () => {
  frame.removeAttribute('src');
  URL.revokeObjectURL(previewUrl);
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const action = event.submitter?.value === 'preview' ? 'preview' : 'generate';
  const buttons = [...form.querySelectorAll('[type="submit"]')];
  if (buttons.some(button => button.disabled)) return;
  const activeButton = buttons.find(button => button.value === action);
  for (const button of buttons) button.disabled = true;
  setBusy(activeButton, true);
  status.classList.remove('error');
  status.textContent = action === 'generate' ? 'Generating PDF\u2026' : 'Preparing preview\u2026';
  try {
    const payload = Object.fromEntries(fields.map(fieldControl)
      .filter(control => !control.closest('[hidden]')).map(control => [control.name, control.value]));
    for (const button of addButtons) {
      if (button.closest('[hidden]')) continue;
      payload[button.dataset.add] = readRows(button, true);
    }
    if (payload.format === 'reference') payload.photo = await readPhoto(form.elements.photo.files[0]);
    const response = await fetch(`/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    if (action === 'preview') {
      previewUrl = URL.createObjectURL(new Blob([result.html], { type: 'text/html;charset=utf-8' }));
      frame.src = previewUrl;
      preview.showModal();
      status.textContent = '';
    } else {
      status.textContent = `Saved to ${result.path}`;
    }
  } catch (error) {
    status.classList.add('error');
    status.textContent = error.message;
  } finally {
    setBusy(activeButton, false);
    for (const button of buttons) button.disabled = false;
  }
});
