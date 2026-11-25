import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function loadTemplate(file) {
  return (await readFile(new URL(file, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}
const [template, classicTemplate] = await Promise.all([loadTemplate('./template.html'), loadTemplate('./classic.html')]);
export const templateStyleSources = [template, classicTemplate].map(document =>
  `'sha256-${createHash('sha256').update(/<style>([\s\S]*?)<\/style>/.exec(document)[1]).digest('base64')}'`).join(' ');
const escape = value => value.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const photoPattern = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export class InputError extends Error {}

function text(value, field, required = false, limit = 250) {
  if (typeof (value ?? '') !== 'string' || (value ?? '').length > limit) {
    throw new InputError(`${field} must be text of at most ${limit} characters.`);
  }
  const clean = (value ?? '').trim();
  if (required && !clean) throw new InputError(`${field} is required.`);
  return clean;
}

function rows(value, field, map) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 30) {
    throw new InputError(`${field} must be a list with at most 30 items.`);
  }
  return value.map((row, i) => map(row, `${field} item ${i + 1}`));
}

function lines(value, field) {
  return text(value, field, false, 4000).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function entries(value, field) {
  return rows(value, field, (row, label) => {
    const entry = {
      title: text(row?.title, `${label} title`),
      organization: text(row?.organization, `${label} organization`),
      location: text(row?.location, `${label} location`),
      period: text(row?.period, `${label} dates`, false, 80),
      highlights: lines(row?.highlights, `${label} highlights`),
    };
    if (!Object.values(entry).some(value => value.length)) return null;
    if (!entry.title) throw new InputError(`${label} needs a title.`);
    return entry;
  }).filter(Boolean);
}

export function companyFolder(company) {
  const name = text(company, 'Company', true, 120).normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_')
    .replace(/\s+/gu, '_').replace(/_+/g, '_').replace(/^[_.]+|[_.]+$/g, '');
  if (!name) throw new InputError('Company needs at least one usable character.');
  return `Resume_${name}`;
}

const list = items => items.length ? `<ul>${items.map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : '';

function entryHtml({ title, organization, location, period, highlights }) {
  const detail = [organization, location].filter(Boolean).map(escape).join(' | ');
  return `<article><header class="entry-heading"><h3>${escape(title)}</h3>${period ? `<span class="period">${escape(period)}</span>` : ''}</header>${detail ? `<p>${detail}</p>` : ''}${list(highlights)}</article>`;
}

function skillGroups(value) {
  return rows(value, 'Skills', (row, label) => {
    const group = text(row?.group, `${label} group`);
    const items = lines(row?.items, `${label} skills`);
    if (group && !items.length) throw new InputError(`${label} needs at least one skill.`);
    return { group, items };
  }).filter(({ items }) => items.length);
}

function renderReference(input) {
  const name = text(input?.name, 'Name', true);
  const role = text(input?.role, 'Role');
  const email = text(input?.email, 'Email');
  const photo = text(input?.photo, 'Photo', false, 7_000_000);
  if (photo && !photoPattern.test(photo)) throw new InputError('Photo must be a JPEG, PNG, or WebP image.');
  const contacts = [
    name, text(input?.location, 'Location'), text(input?.contactNote, 'Additional contact line'),
    email, text(input?.phone, 'Phone'),
    ...lines(input?.links, 'Websites and other contact details'),
  ].filter(Boolean);
  const profile = text(input?.profile, 'Profile', false, 4000);
  const education = entries(input?.education, 'Education');
  const experience = entries(input?.experience, 'Experience');
  const skills = skillGroups(input?.skills).map(({ group, items }) =>
    `<div class="skill-group">${group ? `<h3>${escape(group)}</h3>` : ''}${list(items)}</div>`);
  const sections = [
    ['Profile', profile && `<p class="profile">${escape(profile)}</p>`],
    ['Education', education.map(entryHtml).join('')],
    ['Skills', skills.length && `<div class="skills">${skills.join('')}</div>`],
    ['Experience', experience.map(entryHtml).join('')],
  ].filter(([, body]) => body).map(([heading, body], i) =>
    `<section class="section-${heading.toLowerCase()}" aria-labelledby="section-${i + 1}"><h2 id="section-${i + 1}">${heading}<span aria-hidden="true">0${i + 1}</span></h2><div class="section-body">${body}</div></section>`).join('');
  const slots = {
    name: escape(name),
    role: role ? `<h1>${escape(role)}</h1>` : '',
    photo: photo ? `<img class="photo" alt="" src="${escape(photo)}">` : '',
    contact: contacts.length ? `<ul class="contact" aria-label="Contact details">${contacts.map(
      item => `<li>${escape(item)}</li>`).join('')}</ul>` : '',
    sections,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => slots[key]);
}

function pair(left, right, className = '') {
  if (!left && !right) return '';
  return `<div class="pair ${className}"><span>${left}</span><span>${right}</span></div>`;
}

function classicEntries(value, label, jake) {
  return entries(value, label).map(({ title, organization, location, period, highlights }) => {
    const primary = jake ? title : organization || title;
    const secondary = jake ? organization : organization && title;
    return `<li>${pair(escape(primary), escape(jake ? period : location), 'primary')}` +
      `${pair(escape(secondary), escape(jake ? location : period), 'secondary')}${list(highlights)}</li>`;
  }).join('');
}

function classicProjects(value, jake) {
  return rows(value, 'Projects', (row, label) => {
    const title = text(row?.title, `${label} title`);
    const highlights = lines(row?.highlights, `${label} descriptions`);
    const technologies = jake ? text(row?.technologies, `${label} technologies`) : '';
    const period = jake ? text(row?.period, `${label} dates`, false, 80) : '';
    if (!title && !highlights.length && !technologies && !period) return '';
    if (!title) throw new InputError(`${label} needs a title.`);
    const name = `<strong>${escape(title)}</strong>`;
    return jake
      ? `<li>${pair(`${name}${technologies ? ` | ${escape(technologies)}` : ''}`, escape(period), 'project-heading')}${list(highlights)}</li>`
      : `<li>${name}${highlights.length ? `: ${highlights.map(escape).join('<br>')}` : ''}</li>`;
  }).join('');
}

function renderClassic(input, format) {
  const jake = format === 'jake';
  const name = escape(text(input?.name, 'Name', true));
  const phone = escape(text(input?.phone, 'Phone'));
  const email = escape(text(input?.email, 'Email'));
  const links = lines(input?.links, 'Websites and other contact details').map(escape);
  const heading = jake
    ? `<h1>${name}</h1>${[phone, email, ...links].some(Boolean) ? `<p class="contact">${[phone, email, ...links].filter(Boolean).join(' | ')}</p>` : ''}`
    : `<div><h1>${name}</h1>${links.map(link => `<p>${link}</p>`).join('')}</div>` +
      `<div class="contact">${email ? `<p>Email : ${email}</p>` : ''}${phone ? `<p>Mobile : ${phone}</p>` : ''}</div>`;
  const sections = [
    ['Education', classicEntries(input?.education, 'Education', jake)],
    ['Work Experience', classicEntries(input?.experience, 'Experience', jake)],
    ['Projects', classicProjects(input?.projects, jake)],
    ...(jake ? [['Technical Skills', skillGroups(input?.skills).map(({ group, items }) =>
      `<li>${group ? `<strong>${escape(group)}</strong> | ` : ''}${items.map(escape).join(', ')}</li>`).join('')]] : []),
  ].filter(([, body]) => body).map(([label, body]) =>
    `<section class="${label.toLowerCase().replaceAll(' ', '-')}"><h2>${label}</h2><ul class="entries">${body}</ul></section>`).join('');
  const slots = { format, name, heading, sections };
  return classicTemplate.replace(/\{\{(\w+)\}\}/g, (_, key) => slots[key]);
}

export function renderResume(input) {
  const format = input?.format ?? 'reference';
  if (format === 'reference') return renderReference(input);
  if (format === 'jake' || format === 'sb2nov') return renderClassic(input, format);
  throw new InputError('Unknown resume format.');
}

export async function saveResume(root, company, name, pdf) {
  const folder = companyFolder(company);
  const directory = join(root, folder);
  const stem = name.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\s]+/gu, '_')
    .replace(/^[_.]+|[_.]+$/g, '').slice(0, 75);
  await mkdir(directory, { recursive: true });
  for (let i = 1; ; i++) {
    const filename = `${stem ? `${stem}_` : ''}Resume${i === 1 ? '' : `_${i}`}.pdf`;
    try {
      await writeFile(join(directory, filename), pdf, { flag: 'wx' });
      return `${folder}\\${filename}`;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}
