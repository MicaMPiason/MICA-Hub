(function (global) {
  'use strict';
  // Derived account data only. This module never saves, normalizes or mutates records.
  const day = value => {
    if (!value) return '';
    const date = new Date(String(value).length === 10 ? value + 'T12:00:00' : value);
    return Number.isNaN(+date) ? '' : date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  };
  const shift = (value, offset) => { const d = new Date(value + 'T12:00:00'); d.setDate(d.getDate() + offset); return day(d); };
  const within = (value, range) => !!value && (!range.start || value >= range.start) && value <= range.end;
  const number = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  function range(period, now = new Date()) {
    const end = day(now);
    const start = period === 'all' ? '' : period === 'today' ? end : period === 'month' ? end.slice(0, 8) + '01' : shift(end, -(period === '7' ? 6 : 29));
    return { start, end };
  }
  function comparison(value, previous, enabled = true, percentage = false) {
    if (!enabled) return { direction: 'neutral', text: 'Sem comparação', detail: 'O período completo não tem intervalo anterior equivalente.' };
    if (!previous) return { direction: value ? 'neutral' : 'flat', text: value ? 'Sem base anterior' : 'Sem variação', detail: 'O período anterior registrou zero.' };
    const change = percentage ? value - previous : (value - previous) / previous * 100;
    return { direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat', text: !change ? 'Sem variação' : (change > 0 ? '+' : '−') + new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Math.abs(change)) + (percentage ? ' p.p.' : '%'), detail: 'Em relação ao intervalo anterior de mesma duração.' };
  }
  function facts(item, matches, now) {
    const record = item.record, events = [], seen = new Map();
    (record.history || []).forEach((event, index) => {
      const at = day(event.at);
      if (!at || +new Date(event.at) > +now || event.meta?.launchedOnly) return;
      const kinds = ['contacts', 'meetings', 'proposals', 'conversations', 'sales'].filter(kind => matches(event, kind));
      if (event.type === 'call') kinds.push('calls');
      if (event.type === 'whatsapp') kinds.push('messages');
      kinds.forEach(kind => {
        // A stage change and its accompanying event share an operation ID.
        const key = kind + ':' + (event.meta?.operationId || (['sales', 'meetings', 'proposals'].includes(kind) ? event.at : event.id || index));
        if (!seen.has(key)) { seen.set(key, events.length); events.push({ kind, day: at, event }); }
        else if (events[seen.get(key)].event?.type === 'stage' && event.type !== 'stage') events[seen.get(key)].event = event;
      });
    });
    const lastContact = day(record.lastContact);
    if (lastContact && lastContact <= day(now) && !events.some(e => e.kind === 'contacts' && e.day === lastContact)) events.push({ kind: 'contacts', day: lastContact });
    const pipeline = record.pipeline || {}, closures = [...(pipeline.previousClosures || []), ...(pipeline.closure ? [pipeline.closure] : [])];
    const wonClosures = closures.filter(c => c.result === 'won'), latestClosure = wonClosures[wonClosures.length - 1];
    const latestSale = events.filter(e => e.kind === 'sales').sort((a, b) => String(a.event.at).localeCompare(String(b.event.at))).pop();
    // One lead represents one deal, matching the existing financial idempotency rule.
    // Reconfirmation replaces the commercial snapshot, never multiplies revenue.
    // Closure dates are authoritative (a sale may be entered after its actual date).
    const wins = [];
    if (latestClosure) { if (!day(latestClosure.date) || day(latestClosure.date) <= day(now)) wins.push({ day: day(latestClosure.date), value: number(latestClosure.value) }); }
    else if (latestSale) wins.push({ day: latestSale.day, value: number(latestSale.event.meta?.value ?? (pipeline.stage === 'fechado' ? record.negotiation?.closedValue : 0)) });
    else if (pipeline.stage === 'fechado') wins.push({ day: '', value: number(record.negotiation?.closedValue) });
    const losses = closures.filter(c => c.result === 'lost').map(c => ({ day: day(c.date), name: c.reason || record.negotiation?.lossReason || 'Não informado' }));
    (record.history || []).forEach(e => {
      if (!['loss', 'lost'].includes(e.type) && !(e.type === 'stage' && e.meta?.to === 'perdido')) return;
      const at = day(e.at);
      if (at && +new Date(e.at) <= +now) {
        const existing = losses.find(l => l.day === at);
        if (!existing) losses.push({ day: at, name: e.meta?.reason || record.negotiation?.lossReason || 'Não informado' });
        else if (e.meta?.reason && !closures.some(c => c.result === 'lost' && day(c.date) === at)) existing.name = e.meta.reason;
      }
    });
    if (pipeline.stage === 'perdido' && !losses.length) losses.push({ day: '', name: record.negotiation?.lossReason || 'Não informado' });
    return { ...item, events, wins, losses, created: +new Date(item.createdAt) > +now ? '' : day(item.createdAt) };
  }
  function aggregate(items, interval, all) {
    const eventIn = e => within(e.day, interval), closureIn = e => e.day ? eventIn(e) : all;
    const cohort = items.filter(item => all || within(item.created, interval) || item.events.some(eventIn) || item.wins.some(closureIn) || item.losses.some(closureIn));
    const events = cohort.flatMap(item => item.events.filter(eventIn));
    const count = kind => events.filter(e => e.kind === kind).length;
    const distinct = kind => cohort.filter(item => item.events.some(e => e.kind === kind && eventIn(e))).length;
    const wins = cohort.flatMap(item => item.wins.filter(closureIn)), worked = all ? cohort.filter(item => item.events.some(e => e.kind === 'contacts') || number(item.record.attempts) > 0).length : distinct('contacts');
    const closed = cohort.filter(item => item.wins.some(closureIn)).length;
    const attempts = all ? cohort.reduce((sum, item) => sum + Math.max(number(item.record.attempts), item.events.filter(e => e.kind === 'calls').length), 0) : count('calls');
    const revenue = wins.reduce((sum, win) => sum + win.value, 0);
    return { cohort, events, total: cohort.length, worked, attempts, messages: count('messages'), conversations: count('conversations'), meetings: distinct('meetings'), proposals: distinct('proposals'), closed,
      answerRate: attempts ? Math.round(events.filter(e => e.kind === 'calls' && e.event?.meta?.answered).length / attempts * 100) : 0,
      interested: cohort.filter(i => ['oportunidades', 'propostas', 'fechado'].includes(i.record.pipeline.stage)).length,
      negotiations: cohort.filter(i => i.record.pipeline.substatus === 'Negociando valores').length,
      closeRate: cohort.length ? Math.round(closed / cohort.length * 100) : 0,
      potential: cohort.filter(i => !['fechado', 'perdido'].includes(i.record.pipeline.stage)).reduce((sum, i) => sum + number(i.potential), 0), revenue, ticket: wins.length ? revenue / wins.length : 0, wins };
  }
  function build({ items, stages, segments, matches, period = '30', segmentId = 'all', now = new Date() }) {
    const interval = range(period, now), all = period === 'all';
    const scope = items.filter(i => segmentId === 'all' || i.segmentId === segmentId).map(i => facts(i, matches, now));
    const current = aggregate(scope, interval, all);
    const days = interval.start ? Math.round((new Date(interval.end + 'T12:00:00Z') - new Date(interval.start + 'T12:00:00Z')) / 86400000) + 1 : 0;
    const previousRange = { start: days ? shift(interval.start, -days) : '', end: days ? shift(interval.start, -1) : '' };
    const previous = days ? aggregate(scope, previousRange, false) : {};
    const trends = {};
    ['total', 'worked', 'attempts', 'messages', 'conversations', 'answerRate', 'meetings', 'proposals', 'closed', 'closeRate', 'revenue', 'ticket'].forEach(key => { trends[key] = comparison(current[key], previous[key], !all, ['answerRate', 'closeRate'].includes(key)); });
    const rows = values => { const max = Math.max(1, ...values.map(v => v.value)); return values.map(v => ({ ...v, pct: v.value / max * 100 })); };
    const group = values => { const map = new Map(); values.forEach(name => map.set(name, (map.get(name) || 0) + 1)); return rows([...map].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'pt-BR'))); };
    const funnel = rows(stages.filter(s => s.id !== 'perdido').map(stage => ({ name: stage.name, value: current.cohort.filter(i => i.record.pipeline.stage === stage.id).length, color: stage.color })));
    const origins = group(current.cohort.map(i => String(i.source || '').trim() || 'Não informada'));
    const losses = group(current.cohort.flatMap(i => i.losses.filter(l => l.day ? within(l.day, interval) : all).map(l => l.name)));
    const ranking = rows(segments.map(segment => { const members = current.cohort.filter(i => i.segmentId === segment.id); return { name: segment.name, value: members.length, closed: members.filter(i => i.wins.some(w => w.day ? within(w.day, interval) : all)).length }; }).filter(row => row.value).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'pt-BR')));
    const dated = scope.flatMap(i => [i.created, ...i.events.map(e => e.day), ...i.wins.map(w => w.day)]).filter(d => d && d <= interval.end).sort();
    // Up to 30 calendar buckets; zeros are actual days with no recorded events, not invented data.
    const chartStart = interval.start || dated[0] || interval.end;
    const duration = Math.max(1, Math.round((new Date(interval.end + 'T12:00:00Z') - new Date(chartStart + 'T12:00:00Z')) / 86400000) + 1);
    const size = Math.ceil(duration / 30), timeline = [];
    for (let start = chartStart; start <= interval.end; start = shift(start, size)) {
      const end = [shift(start, size - 1), interval.end].sort()[0], bucket = { start, end };
      const events = current.events.filter(e => within(e.day, bucket));
      const count = kind => events.filter(e => e.kind === kind).length;
      timeline.push({ day: start, end, calls: count('calls'), messages: count('messages'), conversations: count('conversations'), total: current.cohort.filter(i => within(i.created, bucket)).length,
        worked: current.cohort.filter(i => i.events.some(e => e.kind === 'contacts' && within(e.day, bucket))).length,
        revenue: current.wins.filter(w => within(w.day, bucket)).reduce((sum, w) => sum + w.value, 0) });
    }
    const undated = scope.filter(i => !i.created || i.wins.some(w => !w.day) || i.losses.some(l => !l.day) || (i.record.attempts > 0 && !i.events.some(e => e.kind === 'calls'))).length;
    return { ...current, interval, previousRange, trends, funnel, origins, losses, ranking, timeline, undated, all, seriesGrouped: size > 1 };
  }
  function goalProgress(model, kind, interval) {
    return model.cohort.filter(item => kind === 'sales'
      ? item.wins.some(win => within(win.day, interval))
      : item.events.some(event => event.kind === kind && within(event.day, interval))).length;
  }
  global.MicaDashboard = { build, range, comparison, day, within, goalProgress };
})(typeof window !== 'undefined' ? window : globalThis);
