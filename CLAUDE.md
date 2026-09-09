# CONTEXTO BASE DO PROJETO

Use o contexto abaixo como referência obrigatória em todos os prompts seguintes.

Estamos construindo um SaaS de monitoramento de infraestrutura inspirado conceitualmente em Nagios/Zabbix, porém muito mais simples, moderno e focado inicialmente apenas em monitoramento ICMP/Ping.

O produto deve nascer preparado para receber futuramente novos tipos de monitoramento, como HTTP, TCP, DNS, SNMP e agentes, mas nenhum deles faz parte do MVP.

## Stack obrigatória

Frontend:

* React
* TypeScript
* Vite
* Tailwind CSS
* shadcn/ui
* TanStack Query
* React Flow / @xyflow/react
* Dagre para auto-layout da topologia

Backend:

* Python
* FastAPI
* SQLAlchemy 2
* Alembic
* Pydantic

Monitoramento:

* Python asyncio
* icmplib

Banco:

* PostgreSQL

Armazenamento:

* MinIO rodando obrigatoriamente como container
* API compatível com S3
* Bucket privado
* URLs assinadas para leitura de imagens

Infraestrutura:

* Docker Compose
* Caddy como reverse proxy

Arquitetura inicial:

```text
frontend
backend
monitor-worker
postgres
minio
caddy
```

Não adicionar sem necessidade:

* Redis
* Celery
* Kafka
* RabbitMQ
* Kubernetes
* Elasticsearch

O projeto deve priorizar:

* simplicidade;
* separação clara de responsabilidades;
* segurança multi-tenant;
* facilidade de manutenção;
* MVP rápido;
* possibilidade de evolução sem reescrever o sistema inteiro.

---

# PROMPT 01 — FUNDAÇÃO DO PROJETO

Crie a estrutura inicial de um SaaS de monitoramento de infraestrutura.

Use obrigatoriamente:

Frontend:

* React + TypeScript + Vite
* Tailwind
* shadcn/ui
* TanStack Query

Backend:

* Python
* FastAPI
* SQLAlchemy 2
* Alembic
* Pydantic

Persistência:

* PostgreSQL

Storage:

* MinIO

Infra:

* Docker Compose
* Caddy

Estruture o repositório aproximadamente assim:

```text
/
├── frontend/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── repositories/
│   ├── monitor/
│   └── migrations/
├── docker-compose.yml
├── .env.example
└── README.md
```

Requisitos:

1. Cada serviço deve ter Dockerfile próprio.
2. Docker Compose deve subir:

   * frontend;
   * backend;
   * worker;
   * postgres;
   * minio;
   * caddy.
3. PostgreSQL precisa ter healthcheck.
4. Backend deve aguardar banco saudável.
5. MinIO deve ter volume persistente.
6. Criar automaticamente um bucket privado para imagens dos ativos.
7. Nenhuma credencial deve ficar hardcoded.
8. Criar `.env.example`.
9. Backend deve possuir:

   * `/health`;
   * `/api/health`.
10. Configurações devem ser centralizadas usando variáveis de ambiente.
11. O projeto deve iniciar usando apenas:

```bash
docker compose up --build
```

Não implemente funcionalidades de negócio ainda.

Primeiro estabeleça uma fundação limpa, funcionando e documentada.

Ao concluir:

* mostre a árvore final de arquivos;
* explique como subir o projeto;
* explique as decisões arquiteturais;
* liste qualquer débito técnico deixado intencionalmente para etapas futuras.

---

# PROMPT 02 — MODELO MULTI-TENANT E BANCO

Implemente o modelo de dados inicial do SaaS.

Todas as entidades pertencentes a clientes devem ser corretamente isoladas por organização.

Criar os modelos:

## users

Campos sugeridos:

```text
id UUID
name
email
password_hash
status
created_at
updated_at
```

Email deve ser único globalmente.

## organizations

```text
id UUID
name
slug
plan
status
created_at
updated_at
```

## organization_users

Tabela de associação entre usuário e organização.

```text
organization_id
user_id
role
created_at
```

Roles iniciais:

```text
owner
admin
operator
viewer
```

Um usuário pode participar de mais de uma organização.

## organization_invites

```text
id
organization_id
email
role
token_hash
expires_at
accepted_at
created_at
created_by
```

Nunca armazenar token de convite puro no banco.

## sites

```text
id
organization_id
name
description
address
created_at
updated_at
```

## assets

```text
id
organization_id
site_id
name
hostname
ip_address
description
enabled
status
last_rtt_ms
packet_loss
last_check_at
created_at
updated_at
```

Status:

```text
unknown
up
warning
down
```

## checks

```text
id
organization_id
asset_id
type
enabled
interval_seconds
timeout_seconds
config JSONB
next_check_at
last_check_at
created_at
updated_at
```

O primeiro tipo suportado será:

```text
ping
```

Mas o modelo precisa aceitar tipos futuros.

## check_results

```text
id
organization_id
check_id
asset_id
status
latency_ms
packet_loss
message
checked_at
```

## topology_links

```text
id
organization_id
site_id
source_asset_id
target_asset_id
link_type
created_at
```

Não usar `parent_id` como coluna em `assets`, pois a topologia precisa suportar grafos no futuro — mas os ativos **devem** ter um conceito de pai/hierarquia, usado para montar a topologia automaticamente.

A forma correta de fazer isso: `parent_asset_id` é exposto na API/formulário do ativo como conveniência, e por baixo dos panos é sincronizado com um `topology_link` de `link_type="parent"` (source = pai, target = filho). Invariantes mantidas pela camada de serviço, não por constraint de banco:

* no máximo um link `parent` por ativo (um ativo tem no máximo um pai);
* pai e filho precisam pertencer ao mesmo site;
* não pode criar ciclo na cadeia de pais;
* ativo não pode ser pai de si mesmo.

Isso preserva `topology_links` como grafo genérico (outros `link_type` continuam livres para representar conexões que não são hierarquia) e ainda assim dá ao usuário uma forma simples de declarar "ativo pai" ao criar/editar um ativo, sem precisar desenhar a conexão manualmente no editor de topologia.

## asset_photos

```text
id
organization_id
asset_id
storage_key
filename
mime_type
size_bytes
caption
position
uploaded_by
created_at
```

## audit_logs

Estruture uma tabela básica:

```text
id
organization_id
user_id
action
entity_type
entity_id
metadata JSONB
created_at
```

Requisitos adicionais:

* UUID como identificador principal.
* Todas as datas em UTC.
* Índices adequados para:

  * organization_id;
  * site_id;
  * asset_id;
  * check_id;
  * next_check_at;
  * status.
* Criar migrations Alembic.
* Não duplicar desnecessariamente regras de negócio dentro dos models.
* Criar constraints e foreign keys adequadamente.

Multi-tenancy é requisito crítico.

Nunca deve existir um caminho simples para um usuário da organização A acessar informações da organização B.

Ao finalizar:

* apresente diagrama textual das entidades;
* explique índices;
* explique decisões de isolamento multi-tenant.

---

# PROMPT 03 — AUTENTICAÇÃO E SESSÃO

Implemente autenticação completa para o SaaS.

Funcionalidades:

* cadastro;
* login;
* logout;
* refresh da autenticação;
* usuário atual;
* troca de senha;
* recuperação de senha preparada estruturalmente.

Use hashing seguro para senhas.

Não invente uma solução criptográfica.

Utilize biblioteca consolidada.

Rotas esperadas:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/refresh
GET  /api/auth/me
POST /api/auth/change-password
```

No cadastro inicial:

1. criar usuário;
2. criar organização;
3. tornar usuário `owner` da organização.

Exemplo:

```text
João cria conta
    ↓
User João
    ↓
Organization Minha Empresa
    ↓
organization_users:
João → owner
```

O backend deve ter dependency para obter:

```python
current_user
current_organization
current_membership
```

Nunca confiar em um `organization_id` enviado pelo frontend sem validar que o usuário pertence à organização.

Deixe a estrutura preparada para futuramente suportar Google, Microsoft e SSO, mas não implemente esses provedores agora.

---

# PROMPT 04 — RBAC E ISOLAMENTO DE ORGANIZAÇÕES

Implemente autorização baseada nos papéis:

```text
owner
admin
operator
viewer
```

Regras iniciais:

### owner

Pode:

* fazer tudo;
* gerenciar usuários;
* alterar roles;
* gerenciar organização;
* criar/editar/remover ativos;
* alterar topologia.

### admin

Pode:

* gerenciar usuários exceto remover/rebaixar owner;
* criar/editar/remover sites;
* criar/editar/remover ativos;
* alterar monitoramentos;
* alterar topologia.

### operator

Pode:

* criar/editar ativos;
* alterar checks;
* alterar topologia;
* visualizar todos os dados operacionais.

Não pode gerenciar usuários.

### viewer

Somente leitura.

Implemente permissões no backend.

Não esconda apenas botões no frontend.

Toda autorização crítica deve ocorrer na API.

Crie helpers/dependencies reutilizáveis para evitar:

```python
if role == ...
```

espalhado em dezenas de controllers.

Crie testes automatizados verificando:

* organização A não acessa organização B;
* viewer não altera ativo;
* operator não gerencia usuário;
* admin não remove owner;
* owner possui acesso integral.

---

# PROMPT 05 — ORGANIZAÇÕES, USUÁRIOS E CONVITES

Crie as interfaces e APIs para gerenciamento da organização.

Funcionalidades:

## Organização

* visualizar organização atual;
* editar nome;
* visualizar plano atual.

## Usuários

Tela com:

```text
Nome
Email
Role
Status
Ações
```

Possibilitar:

* alterar role;
* remover membro;
* filtrar;
* buscar.

## Convites

Permitir convidar por:

```text
email
role
```

Fluxo:

```text
Admin cria convite
        ↓
token seguro é gerado
        ↓
somente hash fica no banco
        ↓
link é enviado ou retornado no ambiente de desenvolvimento
        ↓
usuário aceita
        ↓
membership é criado
```

Criar endpoints adequados.

No ambiente de desenvolvimento, se serviço de email não estiver configurado, permitir visualizar o link do convite claramente nos logs ou através de mecanismo somente-dev.

Não implementar provedor externo de email neste momento.

---

# PROMPT 06 — SITES

Implemente CRUD completo de sites.

Site pertence obrigatoriamente a uma organização.

Campos:

```text
name
description
address
```

Rotas:

```text
GET    /api/sites
POST   /api/sites
GET    /api/sites/{id}
PATCH  /api/sites/{id}
DELETE /api/sites/{id}
```

Regras:

* site nunca pode pertencer a duas organizações;
* verificar RBAC;
* impedir acesso cross-tenant;
* na remoção de site com ativos existentes, não apagar silenciosamente os ativos.

A UI deve oferecer:

* listagem;
* pesquisa;
* criação;
* edição;
* exclusão com confirmação adequada;
* indicador da quantidade de ativos.

---

# PROMPT 07 — CRUD DE ATIVOS

Implemente gerenciamento completo de ativos.

Campos iniciais:

```text
name
hostname
ip_address
description
site_id
enabled
```

Não coloque configuração específica de ping diretamente no ativo.

Monitoramentos pertencem a `checks`.

Funcionalidades:

* criar ativo;
* editar;
* remover;
* ativar/desativar;
* buscar;
* filtrar por site;
* filtrar por estado;
* visualizar detalhes.

Validação:

* IPv4;
* IPv6;
* hostname;
* campos obrigatórios.

Um ativo deve apresentar:

```text
nome
status
IP ou hostname
site
descrição
RTT
packet loss
última checagem
monitoramentos
fotos
```

Endpoints:

```text
GET    /api/assets
POST   /api/assets
GET    /api/assets/{id}
PATCH  /api/assets/{id}
DELETE /api/assets/{id}
```

A listagem deve suportar paginação e busca.

Evite retornar milhares de objetos sem paginação.

---

# PROMPT 08 — STORAGE MINIO E FOTOS DOS ATIVOS

Implemente armazenamento de fotos utilizando obrigatoriamente MinIO rodando dentro do Docker Compose.

Não armazenar dados binários no PostgreSQL.

O PostgreSQL guarda somente metadados.

Estrutura no MinIO:

```text
organizations/
  {organization_id}/
    assets/
      {asset_id}/
        {uuid}.{extension}
```

Bucket privado.

Nunca permitir acesso público irrestrito.

Implementar service abstraction:

```python
StorageService
```

Métodos conceituais:

```text
upload
delete
get_presigned_url
exists
```

O código de negócio não deve depender diretamente do SDK do MinIO.

Isso permitirá trocar futuramente MinIO por AWS S3, Cloudflare R2 ou outro storage S3-compatible.

Funcionalidades:

* múltiplas fotos por ativo;
* upload;
* exclusão;
* legenda;
* ordenação;
* foto principal;
* thumbnail.

Aceitar somente formatos seguros definidos explicitamente, inicialmente:

```text
JPEG
PNG
WebP
```

Definir limite configurável de tamanho, inicialmente 10 MB.

Validar:

* MIME;
* extensão;
* tamanho.

Não confiar somente no nome do arquivo enviado.

Gerar nomes internos com UUID.

Criar thumbnail para listagens.

Rotas sugeridas:

```text
GET    /api/assets/{asset_id}/photos
POST   /api/assets/{asset_id}/photos
PATCH  /api/assets/{asset_id}/photos/{photo_id}
DELETE /api/assets/{asset_id}/photos/{photo_id}
```

As imagens devem ser exibidas usando URLs assinadas temporariamente.

Garantir que:

```text
Cliente A
```

não consiga obter URL assinada para:

```text
foto pertencente ao Cliente B
```

mesmo conhecendo IDs ou storage keys.

Criar testes específicos para esse isolamento.

---

# PROMPT 09 — ENGINE DE MONITORAMENTO PING

Implemente o primeiro monitor worker.

Tecnologias:

* asyncio;
* icmplib;
* PostgreSQL.

Não usar:

* Redis;
* Celery;
* RabbitMQ;
* Kafka.

O worker deve buscar checks vencidos através de uma estratégia segura para múltiplos workers.

Utilizar abordagem equivalente a:

```sql
FOR UPDATE SKIP LOCKED
```

O objetivo é permitir futuramente executar:

```text
worker-01
worker-02
worker-03
```

sem realizar o mesmo check simultaneamente.

Fluxo:

```text
buscar checks vencidos
        ↓
reservar lote
        ↓
executar ICMP concorrentemente
        ↓
interpretar resultados
        ↓
registrar check_result
        ↓
atualizar estado atual do ativo
        ↓
calcular next_check_at
```

Campos relevantes:

```text
interval_seconds
timeout_seconds
config
```

Config inicial do ping:

```json
{
  "packets": 3
}
```

Implementar limites de concorrência.

Um host lento ou offline não pode bloquear todo o worker.

Salvar:

```text
latency_ms
packet_loss
status
message
checked_at
```

Não armazenar exceções Python brutas como mensagem ao usuário.

Normalizar mensagens.

Docker:

O container do worker deve receber somente as capabilities necessárias para executar ICMP.

Evitar modo `privileged`.

---

# PROMPT 10 — MÁQUINA DE ESTADOS DOS ATIVOS

Implemente state evaluation separada do mecanismo de ping.

Não transforme um ativo em DOWN na primeira perda de pacote isolada.

Estados:

```text
unknown
up
warning
down
```

Modelo inicial:

```text
primeiro check ainda não realizado
→ unknown

check saudável
→ up

falha inicial ou latência acima do threshold
→ warning

3 falhas consecutivas
→ down

2 sucessos consecutivos após down
→ up
```

Esses valores devem estar encapsulados em uma camada de política/configuração, evitando números mágicos espalhados pelo projeto.

Registrar:

```text
consecutive_successes
consecutive_failures
```

se necessário no ativo, check ou em state específico.

Escolha a abordagem mais simples e consistente.

O mecanismo precisa poder evoluir depois para diferentes tipos de checks.

Não escreva lógica exclusivamente acoplada ao ICMP dentro do modelo de estado.

---

# PROMPT 11 — HISTÓRICO E PROBLEMAS

Crie os endpoints e UI de histórico.

Para cada ativo mostrar:

* últimas checagens;
* status;
* RTT;
* packet loss;
* timestamp.

Endpoint sugerido:

```text
GET /api/assets/{id}/history
```

Parâmetros:

```text
from
to
limit
```

Criar também:

```text
GET /api/problems
```

Retornar ativos atualmente:

```text
warning
down
```

Mostrar:

```text
ativo
site
status
desde quando
último RTT
última checagem
```

Não implementar ainda uma engine complexa de incidentes e acknowledge.

Prepare a estrutura para isso futuramente, mas mantenha o MVP simples.

---

# PROMPT 12 — TOPOLOGY BACKEND

Implemente API da topologia.

Utilizar `topology_links`.

Cada link:

```text
source_asset_id
target_asset_id
site_id
link_type
```

Endpoints:

```text
GET    /api/topology?site_id=
POST   /api/topology/links
DELETE /api/topology/links/{id}
```

Validar:

* source e target pertencem à organização atual;
* source e target pertencem ao site correto quando necessário;
* não permitir link do cliente A com ativo do cliente B;
* impedir auto-link:

  ```text
  A → A
  ```

Considere proteção contra duplicatas.

A topologia não deve assumir que sempre será uma árvore.

Ela pode se tornar um grafo.

Retornar uma estrutura adequada ao React Flow:

```json
{
  "nodes": [],
  "edges": []
}
```

Cada node deve trazer apenas dados necessários para visualização:

```text
id
name
status
ip
last_rtt_ms
site
has_photo
```

---

# PROMPT 13 — INTERFACE VISUAL COMPLETA

Crie a direção visual e componentes principais do frontend do SaaS.

O produto é uma ferramenta operacional de monitoramento de infraestrutura.

Ela precisa transmitir:

* precisão;
* leitura rápida;
* confiabilidade;
* densidade de informação controlada;
* boa hierarquia visual.

Não faça uma landing page.

Crie uma aplicação operacional.

## REGRAS VISUAIS OBRIGATÓRIAS

### Estrutura e layout

É proibido usar como solução principal o padrão de "grade perfeita".

Não criar a tela inteira com:

```text
card card card card
card card card card
```

com todos os elementos do mesmo tamanho.

Quebre simetrias quando isso melhorar a leitura.

Use diferenças de peso visual para indicar:

```text
estado geral
problemas importantes
topologia
informações secundárias
```

O tamanho de cada container deve responder ao conteúdo real que possui.

Não force todos os cards a terem exatamente as mesmas proporções.

Não utilizar Hero Section de landing page.

Nada de:

```text
título gigante central
subtítulo
botão principal
botão secundário
mockup
```

Isso é uma aplicação administrativa, não uma página de marketing.

### Estética

Evite aparência genérica de projeto Dribbble.

Não usar indiscriminadamente:

* border-radius gigantes;
* sombras esfumaçadas;
* gradientes decorativos;
* neon;
* glows;
* glassmorphism;
* fundos pretos com luzes coloridas.

Prefira:

* bordas discretas;
* separadores;
* hierarquia tipográfica;
* densidade controlada;
* contraste;
* espaçamento funcional.

Cards não precisam ser excessivamente arredondados.

Algo como:

```text
6px
8px
10px
```

é preferível a `24px` em tudo.

### Tipografia

Evitar utilizar Inter ou Roboto como escolha automática para tudo.

Escolha uma combinação tipográfica com personalidade moderada e excelente legibilidade.

Títulos e dados operacionais podem ter tratamentos distintos.

Dados como:

```text
10.10.0.1
1.7 ms
99.98%
```

devem ser facilmente escaneáveis.

Considere fonte monoespaçada apenas onde fizer sentido técnico.

### Função antes da decoração

Todo:

```text
ícone
badge
linha
cor
label
indicador
```

precisa comunicar alguma coisa.

Não adicionar elementos simplesmente para ocupar espaço.

### Microcopy

Nunca utilizar os termos:

* Revolucione;
* Revolucionário;
* Potencialize;
* Maximize;
* Fluxo de trabalho;
* Workflow;
* Próxima geração;
* Next-gen;
* Simplifique;
* De forma descomplicada;
* Ecossistema.

Escrever sempre de forma operacional e concreta.

Ruim:

```text
Potencialize sua infraestrutura.
```

Bom:

```text
Acompanhe ativos offline e identifique onde ocorreu a falha.
```

Não usar frases moralistas de encerramento.

Não escrever:

```text
Porque seu tempo importa.
```

ou equivalentes.

## Layout principal

Criar sidebar desktop contendo:

```text
Visão geral
Topologia
Ativos
Sites
Problemas
Usuários
Configurações
```

Na parte superior deve existir seletor da organização atual quando o usuário fizer parte de múltiplas organizações.

Também deve existir seleção de site quando pertinente.

Criar versão responsiva.

Não esconder informação crítica exclusivamente através de hover.

---

# PROMPT 14 — DASHBOARD

Implemente a página "Visão geral".

Objetivo:

Responder rapidamente:

1. Quantos ativos existem?
2. Quantos estão online?
3. Quantos estão com problema?
4. Onde estão os problemas?
5. Qual foi a atividade recente?

Não transformar o dashboard em um conjunto uniforme de cards.

Criar uma composição assimétrica.

Sugestão conceitual:

```text
┌────────────────────────────────────┐
│ Estado geral                       │
│ 248 ativos                         │
│ 238 UP · 7 WARNING · 3 DOWN        │
└───────────────────┬────────────────┘
                    │
┌───────────────────┴──────┐ ┌─────────────────────┐
│ Problemas atuais         │ │ Sites               │
│                          │ │                     │
│ ● srv-db-02       DOWN   │ │ Matriz       98%   │
│ ● sw-floor-03     WARN   │ │ Filial       100%  │
│ ● ap-recepcao     DOWN   │ │ DC             96% │
└──────────────────────────┘ └─────────────────────┘
```

Os números de status podem ter presença visual forte, mas não criar quatro cards idênticos obrigatoriamente.

Cor deve ser utilizada semanticamente:

```text
UP
WARNING
DOWN
UNKNOWN
```

Evitar excesso de cores.

Criar estado de loading, empty state e erro.

---

# PROMPT 15 — TOPOLOGY TREE VISUAL

Implemente a tela mais importante visualmente do produto: Topologia.

Tecnologias:

```text
@xyflow/react
Dagre
```

Objetivo:

Visualizar ativos como pequenos nós circulares conectados.

Exemplo:

```text
                    INTERNET
                       ●
                       │
                    FIREWALL
                       ●
                       │
                    CORE-SW
                       ●
                  ╱          ╲
                 ╱            ╲
              SW-01          SW-02
                ●              ●
              ╱   ╲          ╱   ╲
             ●     ●        ●     ●
```

Cada node deve apresentar:

```text
bolinha
nome
RTT opcional
```

A bolinha indica estado.

Estados:

```text
UP
WARNING
DOWN
UNKNOWN
```

Não depender exclusivamente da cor.

Adicionar também diferença de ícone, contorno ou pequena indicação para acessibilidade.

Interações:

* zoom;
* pan;
* fit view;
* clicar em ativo;
* abrir painel lateral;
* navegar para detalhes;
* alternar auto-layout;
* selecionar site;
* buscar ativo;
* centralizar ativo encontrado.

A topologia deve suportar árvores grandes.

Evitar renderizar detalhes excessivos em cada node.

O node deve ser compacto.

Ao clicar no ativo, abrir drawer lateral com:

```text
foto principal
nome
status
IP
site
RTT
packet loss
última checagem
descrição resumida
botão "Ver ativo"
```

A imagem pertence ao inspector lateral, não ao node principal.

Implementar auto-layout horizontal ou vertical usando Dagre.

As edges devem ser visualmente discretas.

Não criar linhas neon, glow ou animações contínuas decorativas.

Se uma conexão levar a ativo DOWN, pode existir indicação visual discreta, mas não transformar a tela em árvore de Natal.

---

# PROMPT 16 — EDITOR DE TOPOLOGIA

Adicione modo de edição à topologia.

Modo padrão:

```text
visualização
```

Modo opcional:

```text
editar topologia
```

No modo edição permitir:

* conectar ativos;
* remover conexão;
* reorganizar manualmente;
* executar auto-layout;
* salvar alterações.

Não permitir alterações acidentais durante visualização normal.

Exibir claramente que o modo edição está ativo.

Aplicar RBAC:

```text
owner
admin
operator
```

podem editar.

```text
viewer
```

não pode.

Antes de criar um link:

* validar source;
* validar target;
* impedir auto-link;
* evitar duplicata.

Persistir relações no backend.

Caso posições manuais sejam persistidas, crie uma solução separada dos links topológicos.

Não misturar coordenadas de UI com relação lógica entre ativos.

---

# PROMPT 17 — DETALHE DO ATIVO

Crie uma página detalhada para ativo.

A página deve priorizar leitura operacional.

Layout sugerido:

```text
SW-CORE-01                        ● ONLINE
10.10.0.1 · Matriz

Descrição
Switch principal do CPD...

─────────────────────────────────

Status atual

RTT             Packet loss
1.7 ms          0%

Último check
há 8 segundos

─────────────────────────────────

Histórico de monitoramento

─────────────────────────────────

Fotos

[foto] [foto] [foto]

─────────────────────────────────

Configuração de monitoramento
PING · 30s · timeout 1s
```

Não transforme cada linha em card.

Utilize divisores e agrupamentos adequados.

Criar ações:

```text
Editar ativo
Adicionar foto
Editar monitoramento
Desativar
Excluir
```

A exclusão deve exigir confirmação adequada.

Fotos devem ter:

* visualização ampliada;
* legenda;
* exclusão;
* marcar como principal.

---

# PROMPT 18 — LISTA DE ATIVOS

Crie uma tela eficiente para centenas ou milhares de ativos.

Prefira tabela/lista rica ao invés de um card por ativo.

Colunas sugeridas:

```text
Status
Nome
IP / Hostname
Site
RTT
Perda
Última checagem
```

Suportar:

* busca;
* filtro por site;
* filtro por status;
* ativos habilitados/desabilitados;
* paginação;
* ordenação.

Status deve ser facilmente escaneável.

Ao clicar na linha, abrir ativo.

Pode incluir pequeno thumbnail da foto principal, mas ele não deve ocupar espaço exagerado.

Criar empty state concreto.

Exemplo:

```text
Nenhum ativo cadastrado neste site.
Adicione o primeiro ativo para começar o monitoramento.
```

Evitar textos vagos como:

```text
Comece sua jornada.
```

---

# PROMPT 19 — GERENCIAMENTO DE CHECKS

Crie a interface de configuração dos monitoramentos de um ativo.

Neste MVP existe apenas:

```text
PING
```

Mas a arquitetura visual deve suportar tipos futuros.

Campos:

```text
enabled
interval_seconds
timeout_seconds
packets
```

Exemplo:

```text
Monitoramento

PING
Ativo

Intervalo
30 segundos

Timeout
1 segundo

Pacotes
3
```

Não expor JSON para usuário comum.

O backend pode armazenar:

```json
{
  "packets": 3
}
```

mas frontend deve apresentar formulário apropriado.

Validar intervalos mínimos e máximos definidos pelo backend.

---

# PROMPT 20 — PROBLEMAS

Crie a tela "Problemas".

Mostrar apenas ativos:

```text
warning
down
```

Ordenação padrão:

1. DOWN mais antigo;
2. DOWN recente;
3. WARNING.

Informações:

```text
status
ativo
site
IP
problema
duração
última checagem
```

Exemplo:

```text
● DOWN

SRV-DB-02
10.20.1.17

Datacenter
Sem resposta ICMP

há 12 minutos
```

Não usar um enorme card por problema se houver muitos resultados.

Criar uma listagem compacta e operacional.

Adicionar filtros:

```text
site
status
busca
```

---

# PROMPT 21 — PLANO E ENTITLEMENTS

Deixe a aplicação preparada para planos SaaS sem implementar cobrança ainda.

Organization possui:

```text
plan
```

Criar camada central:

```text
EntitlementService
```

Ela deve responder coisas como:

```text
max_assets
max_users
max_storage_bytes
history_retention_days
```

Não espalhar condições:

```python
if organization.plan == "pro":
```

pelo código.

Criar planos iniciais somente como configuração interna.

Exemplo:

```text
free
starter
pro
business
```

Esses limites não precisam ser definitivos comercialmente.

Objetivo é criar arquitetura, não tabela de preços.

Quando limite for atingido, API deve retornar erro estruturado que o frontend consiga apresentar claramente.

---

# PROMPT 22 — AUDITORIA

Implemente audit log básico.

Registrar ações relevantes:

```text
asset.created
asset.updated
asset.deleted

site.created
site.updated
site.deleted

user.invited
user.role_changed
user.removed

topology.link_created
topology.link_removed

asset.photo_uploaded
asset.photo_deleted

check.created
check.updated
check.disabled
```

Guardar:

```text
organization
user
ação
entidade
entity_id
metadata
timestamp
```

Não salvar:

* senha;
* tokens;
* secrets;
* conteúdo sensível desnecessário.

Criar uma interface administrativa simples para owner/admin consultar eventos recentes.

---

# PROMPT 23 — TESTES

Crie suíte automatizada para os fluxos críticos.

Backend:

* pytest.

Prioridades máximas:

### Multi-tenancy

Testar explicitamente:

```text
Usuário da Organization A
NÃO acessa Asset da Organization B.
```

Fazer o mesmo para:

* sites;
* fotos;
* topology;
* checks;
* resultados;
* usuários.

### RBAC

Testar roles.

### Assets

CRUD.

### Checks

Criação e configuração.

### Monitor worker

Mockar ICMP.

Testar:

* sucesso;
* timeout;
* packet loss;
* exceção;
* mudança de status.

### MinIO

Criar testes de integração do storage service.

Não depender de internet.

### Frontend

Testar pelo menos os fluxos essenciais:

* login;
* listar ativos;
* criar ativo;
* abrir detalhes;
* topologia.

Não perseguir cobertura de 100%.

Priorize o que pode gerar:

* vazamento entre clientes;
* indisponibilidade;
* estado incorreto;
* perda de dados.

---

# PROMPT 24 — OBSERVABILIDADE DA PRÓPRIA APLICAÇÃO

Adicione logging consistente.

Todo serviço deve produzir logs estruturados.

Campos úteis:

```text
timestamp
level
service
organization_id quando aplicável
user_id quando aplicável
asset_id quando aplicável
check_id quando aplicável
message
```

Não logar:

* senha;
* token;
* cookies;
* secrets.

O monitor worker deve registrar:

```text
checks_processados
checks_sucesso
checks_falha
duração_do_lote
```

sem gerar um log por pacote ICMP individual desnecessariamente.

Criar endpoints básicos de health.

Não adicionar Prometheus/Grafana ao MVP se não forem necessários.

Prepare código organizado para isso ser incluído posteriormente.

---

# PROMPT 25 — REVISÃO DE SEGURANÇA

Faça uma revisão completa do projeto antes de considerá-lo MVP.

Procure especialmente:

1. falhas de isolamento multi-tenant;
2. IDOR;
3. endpoints sem autorização;
4. uploads inseguros;
5. storage keys previsíveis;
6. bucket MinIO público;
7. URLs assinadas com validade exagerada;
8. CORS permissivo;
9. secrets hardcoded;
10. senhas ou tokens em logs;
11. SQL injection;
12. mass assignment;
13. falta de rate limits onde necessário;
14. falhas na validação de MIME;
15. uso excessivo de privilégios nos containers;
16. worker executando como root desnecessariamente;
17. acesso direto indevido ao PostgreSQL ou MinIO.

Não altere arquitetura desnecessariamente.

Corrija riscos reais.

Produza ao final:

```text
CRÍTICO
ALTO
MÉDIO
BAIXO
```

com achados e correções realizadas.

---

# PROMPT 26 — POLIMENTO DO MVP

Faça uma revisão geral do produto como um SaaS que está prestes a receber seus primeiros usuários reais.

Não adicione funcionalidades grandes.

Procure:

* telas incompletas;
* erros sem feedback;
* loaders ruins;
* empty states;
* inconsistências de nomenclatura;
* ações destrutivas sem confirmação;
* navegação confusa;
* quebra em mobile;
* topologia ilegível;
* componentes repetidos;
* API inconsistente;
* formulários sem validação;
* mensagens técnicas expostas ao usuário;
* falhas de acessibilidade;
* problemas de contraste;
* queries desnecessárias;
* problemas N+1;
* telas que fazem múltiplas requisições redundantes.

Mantenha as regras visuais do projeto:

* sem grade perfeita obrigatória;
* sem estética Dribbble genérica;
* sem excesso de arredondamento;
* sem glow;
* sem neon;
* sem gradientes decorativos;
* função antes de decoração;
* textos pragmáticos;
* nada de jargões de marketing.

O objetivo desta etapa é fazer o produto parecer intencional e consistente, não adicionar features.

---

# PROMPT 27 — REVISÃO FINAL DE ARQUITETURA

Analise todo o projeto após implementação.

Verifique se a arquitetura ainda respeita:

```text
Organization
    │
    ├── Users
    │
    └── Sites
          │
          └── Assets
               ├── Photos
               ├── Checks
               │    └── Results
               └── Topology Links
```

E:

```text
React
   ↓
FastAPI
   ↓
PostgreSQL

FastAPI
   ↓
MinIO

Worker
   ↓
PostgreSQL
   ↓
ICMP
```

Confirme que não houve introdução injustificada de:

* Redis;
* filas externas;
* microserviços;
* Kubernetes;
* abstrações complexas;
* event bus;
* CQRS;
* arquitetura excessivamente distribuída.

Se encontrar complexidade desnecessária, reduza.

O produto é um MVP SaaS e deve continuar simples.

Ao finalizar apresente:

1. arquitetura atual;
2. principais módulos;
3. principais decisões;
4. pontos fortes;
5. débitos técnicos conhecidos;
6. próximos três recursos que poderiam ser implementados sem grande refatoração.

Não implemente esses próximos recursos ainda.
