// Returns current time as ISO string (stored in msg.time).
export function nowISO() {
  return new Date().toISOString();
}

// Formats a stored msg.time for display in the chat UI.
// ISO strings  → smart format (same day: "10:51 PM", yesterday: "Ayer · 10:51 PM", older: "9 de mayo · 10:51 PM")
// Legacy strings (already formatted, e.g. "10:51 PM") → returned as-is.
export function formatMessageTime(timeStr) {
  if (!timeStr) return '';

  const d = new Date(timeStr);
  if (isNaN(d.getTime())) return timeStr; // backward compat

  const timeOnly = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const now = new Date();

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth()    === now.getMonth()    &&
    d.getDate()     === now.getDate();
  if (sameDay) return timeOnly;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth()    === yesterday.getMonth()    &&
    d.getDate()     === yesterday.getDate();
  if (isYesterday) return `Ayer · ${timeOnly}`;

  const dateLabel = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  return `${dateLabel} · ${timeOnly}`;
}
