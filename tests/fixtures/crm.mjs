// Synthetic contacts only. Never import a real customer database into tests.
export function crmFixture(count = 49) {
  const names = ['TKTeste', 'MaxTeste', 'Paraná Exemplo'];
  return {
    version: 2,
    extraLeads: Array.from({ length: count }, (_, i) => ({
      id: 'fixture-' + i, nome: names[i] || 'Empresa Exemplo ' + String(i + 1).padStart(2, '0'),
      telefone: '+551100000' + String(i + 1).padStart(4, '0'),
      whatsapp: '+551100000' + String(i + 1).padStart(4, '0'),
      cidade: i % 2 ? 'Barueri' : 'São Paulo', site: i % 3 ? '' : 'https://example.invalid',
      nota: '4.9', avaliacoes: 100, origem: 'Teste', businessSegmentId: 'seg_test'
    })),
    records: {}, tasks: [],
    segments: [{ id: 'seg_test', name: 'Climatização', createdAt: '2026-01-01T00:00:00Z' }],
    lastSegmentId: 'all', settings: {}, meta: {}
  };
}
