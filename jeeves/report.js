// @ts-check
import { getWeeklyStats } from './db.js';

const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const REPORT_TO_EMAIL = process.env.REPORT_TO_EMAIL;
const FROM_EMAIL      = 'Jeeves <onboarding@resend.dev>';

function fmtDuration(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function buildHtml(stats, weekLabel) {
  const applianceOrder = ['washer', 'dryer', 'dishwasher'];
  const applianceEmoji = { washer: '🫧', dryer: '🌀', dishwasher: '🍽️' };
  const cycleMap = Object.fromEntries(stats.cycles.map(r => [r.appliance, r]));

  const cycleRows = applianceOrder.map(name => {
    const r = cycleMap[name];
    const emoji = applianceEmoji[name] || '📦';
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    if (!r) {
      return `<tr><td>${emoji} ${label}</td><td>0</td><td>—</td><td>—</td></tr>`;
    }
    return `<tr>
      <td>${emoji} ${label}</td>
      <td>${r.cycle_count}</td>
      <td>${fmtDuration(Math.round(r.avg_duration_s))}</td>
      <td>${fmtDuration(r.max_duration_s)}</td>
    </tr>`;
  }).join('\n');

  const openErrors = stats.errors.filter(e => !e.resolved_at);
  const newErrors  = stats.errors.filter(e => e.resolved_at);

  const errorSection = openErrors.length > 0
    ? `<h2 style="color:#cc2a2a">⚠️ Open Issues (${openErrors.length})</h2>
       <ul>${openErrors.map(e =>
         `<li><strong>${e.source} / ${e.error_type}</strong> — ${e.detail || 'no detail'} (${e.occurrence_count}×, last seen ${new Date(e.last_seen_at * 1000).toLocaleDateString()})</li>`
       ).join('')}</ul>`
    : `<p style="color:#1a9b5c">✅ No open issues.</p>`;

  const resolvedNote = newErrors.length > 0
    ? `<p style="color:#6b7589;font-size:13px">${newErrors.length} error(s) occurred and resolved this week.</p>`
    : '';

  const totalCycles = stats.cycles.reduce((s, r) => s + r.cycle_count, 0);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Jeeves Weekly Report</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1a1e2a;background:#f4f6fa">
  <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #d0d8e8">

    <h1 style="margin:0 0 4px;font-size:22px">🏠 Jeeves Weekly Report</h1>
    <p style="color:#6b7589;margin:0 0 28px;font-size:14px">${weekLabel} · ${totalCycles} cycle${totalCycles !== 1 ? 's' : ''} total</p>

    <h2 style="font-size:15px;margin:0 0 12px">Appliance Cycles</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead>
        <tr style="border-bottom:2px solid #d0d8e8">
          <th style="text-align:left;padding:6px 8px;color:#6b7589;font-weight:600">Appliance</th>
          <th style="text-align:left;padding:6px 8px;color:#6b7589;font-weight:600">Cycles</th>
          <th style="text-align:left;padding:6px 8px;color:#6b7589;font-weight:600">Avg</th>
          <th style="text-align:left;padding:6px 8px;color:#6b7589;font-weight:600">Longest</th>
        </tr>
      </thead>
      <tbody>${cycleRows}</tbody>
    </table>

    <hr style="border:none;border-top:1px solid #d0d8e8;margin:24px 0">

    ${errorSection}
    ${resolvedNote}

    <hr style="border:none;border-top:1px solid #d0d8e8;margin:24px 0">

    <p style="color:#6b7589;font-size:12px;margin:0">
      Energy tracking limited to dishwasher until Emporia Vue is installed.<br>
      Anomaly detection and forecasting will activate after a few more weeks of data.
    </p>

  </div>
</body>
</html>`;
}

export async function sendWeeklyReport() {
  if (!RESEND_API_KEY || !REPORT_TO_EMAIL) {
    console.log('Weekly report skipped: RESEND_API_KEY or REPORT_TO_EMAIL not set');
    return;
  }

  const now     = new Date();
  const sinceTs = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const stats   = getWeeklyStats(sinceTs);

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  const html = buildHtml(stats, weekLabel);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: REPORT_TO_EMAIL,
      subject: `Jeeves Weekly · ${weekLabel}`,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API ${res.status}: ${body}`);
  }

  const data = await res.json();
  console.log(`Weekly report sent (id: ${data.id})`);
}
