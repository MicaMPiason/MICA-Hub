# Pipeline comercial — implementação e compatibilidade

## Investigação e decisões

O projeto continua em HTML, CSS e JavaScript puro. `assets/js/app.js` controla a interface e as regras dos demais módulos. `assets/js/search.js` e `assets/js/proposals.js` continuam independentes. Não foram instaladas dependências, alterados temas ou refeita a sidebar.

O Supabase é inicializado em `src/cloud.js`. A aplicação não consulta tabelas de leads: usa as RPCs `load_crm` e `save_crm`, com um documento JSON por usuário em `private.crm_documents`. A gravação existente é atômica, valida a revisão e usa bloqueio transacional por usuário. A inspeção de produção foi exclusivamente de leitura: metadados, definições das funções, políticas, permissões e nomes dos campos, sem expor contatos.

Confirmado no banco: RLS habilitada; SELECT/INSERT/UPDATE limitados a `auth.uid() = user_id`; WITH CHECK nas escritas; funções públicas SECURITY INVOKER; execução negada a `anon` e concedida a `authenticated`. A função de autorização existente valida sessão e MFA e limita requisições. Não foram feitas alterações de tabelas, políticas, funções, autenticação ou registros de produção. O modelo JSON existente comporta os campos adicionais: não há migração SQL a executar.

O armazenamento do navegador continua limitado à sessão Supabase (`mica-auth`, incluindo PKCE) e ao tema (`mica-theme`). Nenhum dado local foi removido. Não foi reintroduzido modo offline.

## Modelo aditivo

`assets/js/pipeline.js` concentra funções puras de normalização, atividades, movimentação, métricas e prioridade da fila.

Cada registro recebe `pipeline.version = 1`, `pipeline.stage`, `pipeline.substatus`, `pipeline.legacyStage` e, quando aplicável, `pipeline.closure` e `pipeline.previousClosures`. IDs, observações, perfil, contato, histórico, próximas ações e negociação são mantidos. O documento permanece `version: 2`.

O campo antigo `record.stage` permanece como projeção de compatibilidade, mas a classificação comercial principal passa a ser `record.pipeline.stage`. A classificação anterior à conversão fica em `legacyStage`. A normalização acrescenta campos na leitura, sem registrar avanços comerciais ou fabricar atividades/datas. Um histórico real de ligação/WhatsApp pode refinar o substatus inicial.

| Estágio anterior | Etapa principal | Substatus inicial |
| --- | --- | --- |
| a_prospectar | a_prospectar | Novo lead |
| tentando_contato | em_contato | Aguardando resposta |
| conversou | em_contato | Conversou |
| reuniao_agendada | oportunidades | Reunião agendada |
| proposta_enviada | propostas | Proposta enviada |
| negociacao | propostas | Negociando valores |
| fechado | fechado | Venda confirmada |
| perdido | perdido | Negócio perdido |

## Interface e fluxo

- Quatro colunas operacionais: A prospectar, Em contato, Oportunidades e Propostas.
- Finalizados com consultas separadas para Fechados e Perdidos, filtros, busca e reabertura.
- Navegação de uma etapa por vez no celular; quatro colunas quando couberem; largura confortável e rolagem horizontal local em telas médias. Barras permanecem ocultas. Botão Mover e seletor da ficha permitem operar sem arrastar.
- Filtros recolhíveis no celular; filtros anteriores preservados, com etapa principal e substatus adicionados.
- Cards mostram situação, última atividade, próxima ação, atraso, score, segmento, site e ações.
- Minha fila de hoje prioriza atrasos, compromissos de hoje, reuniões próximas, prioritários sem próxima ação e oportunidades pendentes. Finalizados ficam fora.
- Modais de movimento adaptam campos para reunião, esboço, proposta, venda e perda; cancelamento não altera o registro.
- Registrar atividade não muda a etapa. Ligações e WhatsApp usam o mesmo modelo de histórico. Abrir WhatsApp não é tratado como prova de envio: a interação precisa ser confirmada pelo usuário.
- Timeline diferencia atividade, mudança de etapa, retorno, encerramento e reabertura, mantendo eventos antigos.

## Confirmação, integridade e falhas

`MicaData.commit` em `src/cloud.js` aguarda escritas pendentes e envia etapa, substatus, histórico, próxima ação e eventual receita em um único documento à RPC existente. A interface só troca de etapa depois do reconhecimento do servidor. Durante a confirmação, os controles são protegidos contra duplo envio.

Cada operação tem um identificador único. Repetir a mesma operação não duplica os eventos. Se a resposta se perder após a gravação, o cliente tenta reconciliar o identificador com o documento efetivo no servidor. Falhas mantêm o formulário e a etapa anterior. Conflitos com outra sessão bloqueiam sobrescritas e oferecem o backup já existente.

A primeira confirmação de venda cria receita com a data informada. A recorrência mensal é informação comercial; não gera cobranças ou lançamentos mensais automaticamente. Reabrir ou fechar novamente não apaga nem duplica uma receita existente desse lead. Ajustes em receitas já registradas são feitos explicitamente no Financeiro; a pipeline não reescreve o lançamento original.

Dashboard, metas e relatórios distinguem estágio atual de atividade histórica. Não inferem reunião ou proposta só porque o lead avançou para uma etapa posterior e não usam `updatedAt` como data inventada de contato. Metas continuam contando leads distintos no período. O dashboard inclui WhatsApps registrados. CSV mantém as colunas anteriores e acrescenta Substatus e Estágio anterior (auditoria). JSON preserva o documento completo.

O índice em memória `leadById` evita buscas lineares repetidas ao montar cards, filtros e métricas. Ele não persiste dados no navegador.

## Testes e limites de verificação

- `node tests/pipeline-model-test.mjs`: regras puras, oito classificações antigas, imutabilidade, histórico, idempotência, movimentos para trás, fechamento, reabertura e fila.
- `node tests/pipeline-test.mjs`: navegador isolado com contatos fictícios, drag-and-drop, cancelamento, espera de confirmação, duplo envio, falha/repetição, atividades, reunião, proposta, receita, finalizados, reabertura, filtros, busca, timeline e reload.
- `node tests/pipeline-volume-test.mjs`: 1.500 leads fictícios, verificação de contagem e medição de montagem/layout da pipeline. A execução registrada levou 481 ms; é uma medição local em Edge headless, não uma garantia em aparelhos reais.
- `node tests/security-test.mjs`: sessão, isolamento e conflitos simulados, gravação atômica, resposta perdida e bloqueio de saída durante confirmação.
- `node tests/smoke-test.mjs`: regressão dos demais módulos, importações, exportações, financeiro, metas, relatórios, propostas e PDF.
- `node tests/sidebar-test.mjs` e `node tests/responsive-test.mjs`: navegação e seis resoluções, com teclado, mouse e toque simulado em Edge/Chromium.

As gravações dos testes usam servidor isolado ou respostas RPC simuladas. Não foram criados usuários nem gravados leads de teste em produção. As políticas e funções efetivas do Supabase foram inspecionadas, mas não foi executado um fluxo autenticado com duas contas reais. Safari, Firefox e aparelhos físicos não foram testados.

## Arquivos alterados

- `assets/js/pipeline.js`: novo domínio comercial testável e compatível com os estágios anteriores.
- `assets/js/app.js`: integração das quatro etapas, finalizados, fila, filtros, cards, formulários, atividades, timeline, métricas e CSV.
- `assets/css/pipeline.css`: estilos específicos da pipeline, reutilizando os tokens existentes.
- `src/cloud.js`: confirmação explícita de documento, serialização das escritas e reconciliação de resposta perdida.
- `index.html` e `scripts/build.mjs`: carregamento e inclusão do módulo no build.
- `package.json`: comando `npm run test:pipeline`.
- `tests/helpers/browser.mjs`: adaptação de teste isolada para confirmação e simulação de falhas.
- `tests/pipeline-model-test.mjs`, `tests/pipeline-test.mjs` e `tests/pipeline-volume-test.mjs`: novos testes.
- `tests/security-test.mjs`, `tests/smoke-test.mjs` e `tests/responsive-test.mjs`: regressões atualizadas para o novo fluxo.
- Este documento: diagnóstico, compatibilidade, validação e recuperação. A auditoria anterior foi preservada sem alterações.

## Implantação e recuperação

Nenhum deploy ou commit faz parte desta entrega sem pedido de publicação. Antes de publicar, baixar o backup JSON da conta pelo próprio Hub. O CSV é cópia adicional de contatos, não substitui o JSON com histórico e configurações. A auditoria de migração e os backups privados continuam ignorados no Git.

Como não há alteração SQL, não existe rollback de esquema. Para voltar à interface anterior, reimplantar o commit anterior na Vercel sem importar documentos antigos por cima dos atuais. Os campos adicionais são compatíveis com a estrutura JSON; contudo a versão antiga não mantém os novos substatus ao editar etapas. Usar a versão anterior apenas temporariamente, evitar editar a pipeline nela e preservar um JSON completo para eventual recuperação controlada.

Referência de segurança consultada: [Supabase — RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). A inspeção do projeto, e não apenas esta referência, fundamenta as confirmações sobre as políticas existentes.
