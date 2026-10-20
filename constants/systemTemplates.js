const SYSTEM_TEMPLATE_IDS = Object.freeze([
  'elixir-of-life',
  'ancient-scrolls',
  'digital-detox',
  'eight-thousand-steps',
  'archivists-scroll'
]);

function isSystemTemplateId(templateId) {
  return SYSTEM_TEMPLATE_IDS.includes(String(templateId || '').trim());
}

module.exports = {
  SYSTEM_TEMPLATE_IDS,
  isSystemTemplateId
};
