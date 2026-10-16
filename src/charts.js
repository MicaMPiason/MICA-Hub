import { Chart, LineController, LineElement, PointElement, CategoryScale, LinearScale, Filler, Tooltip, DoughnutController, ArcElement } from 'chart.js';

Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Filler, Tooltip, DoughnutController, ArcElement);
let instances = [], lastModel, lastRoot;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const currency = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
const date = value => new Date(value + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
function destroy() { instances.forEach(chart => chart.destroy()); instances = []; lastRoot = lastModel = null; }
function mount(root, model, animate = true) {
  destroy(); lastRoot = root; lastModel = model;
  const css = getComputedStyle(document.documentElement), color = name => css.getPropertyValue('--' + name).trim();
  // Series share the Hub's existing tokens; accessible text legends duplicate every value.
  const palette = [color('accent'), color('info'), color('violet'), color('success'), color('warning'), color('danger'), color('muted')];
  const labels = model.timeline.map(bucket => date(bucket.day) + (bucket.end !== bucket.day ? ' – ' + date(bucket.end) : ''));
  function create(canvas, type, data, options = {}) {
    const chart = new Chart(canvas, { type, data, options: {
      responsive: true, maintainAspectRatio: false, animation: animate && !reducedMotion.matches ? { duration: 280, easing: 'easeOutQuart' } : false,
      color: color('muted'), font: { family: css.getPropertyValue('--font').trim(), size: 11 },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { enabled: true, backgroundColor: color('ink'), titleColor: color('bg'), bodyColor: color('bg'), padding: 12, cornerRadius: 10, displayColors: true } },
      ...options
    } });
    instances.push(chart); return chart;
  }
  try {
    root.querySelectorAll('[data-spark]').forEach(canvas => {
      const key = canvas.dataset.spark, values = model.timeline.map(bucket => bucket[key] || 0), stroke = getComputedStyle(root).getPropertyValue('--dashboard-activity-line').trim();
      create(canvas, 'line', { labels, datasets: [{ data: values, borderColor: stroke, borderWidth: 2, pointRadius: 0, pointHitRadius: 10, tension: .25, fill: false }] }, {
        scales: { x: { display: false }, y: { display: false, beginAtZero: true } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => key === 'revenue' ? currency(context.raw) : String(context.raw) } } }
      });
    });
    const activity = root.querySelector('[data-dashboard-chart="activity"]');
    if (activity) create(activity, 'line', { labels, datasets: [
      { label: 'Ligações', key: 'calls', color: getComputedStyle(root).getPropertyValue('--dashboard-activity-line').trim(), fill: true },
      { label: 'WhatsApps', key: 'messages', color: color('info'), fill: false },
      { label: 'Conversas', key: 'conversations', color: color('violet'), fill: false }
    ].map(series => ({ label: series.label, data: model.timeline.map(bucket => bucket[series.key]), borderColor: series.color, backgroundColor: context => {
      const { ctx, chartArea } = context.chart;
      if (!chartArea) return 'transparent';
      const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      gradient.addColorStop(0, color('accent') + '55'); gradient.addColorStop(1, color('accent') + '00'); return gradient;
    }, fill: series.fill, tension: .25, borderWidth: 2, pointRadius: model.timeline.length === 1 ? 4 : 2, pointHoverRadius: 5, pointHitRadius: 14 })) }, {
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: color('muted'), maxTicksLimit: 7, maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true, suggestedMax: 4, border: { display: false }, ticks: { color: color('muted'), precision: 0, maxTicksLimit: 5 }, grid: { color: color('line'), drawTicks: false } }
      }
    });
    const origins = root.querySelector('[data-dashboard-chart="origins"]');
    if (origins) create(origins, 'doughnut', { labels: model.origins.map(row => row.name), datasets: [{ data: model.origins.map(row => row.value), backgroundColor: model.origins.map((_, index) => palette[index % palette.length]), borderColor: color('surface'), borderWidth: 3, hoverOffset: reducedMotion.matches ? 0 : 5 }] }, {
      cutout: '76%', layout: { padding: 7 }, interaction: { mode: 'nearest', intersect: true }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.label}: ${context.raw} (${Math.round(context.raw / model.total * 100)}%)` } } }
    });
    root.dataset.chartsReady = 'true';
  } catch (error) {
    // A drawing failure must not hide real values or affect other CRM modules.
    instances.forEach(chart => chart.destroy()); instances = [];
    root.querySelectorAll('.dashboard-chart-wrap').forEach(wrap => { wrap.hidden = true; });
    const notice = root.querySelector('[data-chart-error]'); if (notice) notice.hidden = false;
    console.warn('Não foi possível desenhar os gráficos do Dashboard.', error);
  }
}
function refresh() { if (lastRoot?.isConnected && lastModel) mount(lastRoot, lastModel, false); }
new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
reducedMotion.addEventListener('change', refresh);
window.MicaCharts = { mount, destroy, get count() { return instances.length; } };
