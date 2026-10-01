export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Deliberately small renderer: generated HTML and links are never interpreted.
export function renderNotes(text) {
  return String(text || '').split('\n').map(line => {
    let safe=escapeHtml(line).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    const heading=safe.match(/^#{1,6}\s+(.+)$/);
    if(heading)return '<h3>'+heading[1]+'</h3>';
    if(/^[-*]\s/.test(safe))return '<p class="note-bullet">• '+safe.slice(2)+'</p>';
    return safe ? '<p>'+safe+'</p>' : '';
  }).join('');
}
