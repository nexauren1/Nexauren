# Nexauren Tools — Regra Oficial de Criação de Ferramentas

Este documento é a regra de referência para criar, publicar, atualizar ou remover ferramentas do Nexauren.

## 1. Escopo

As regras desta documentação aplicam-se exclusivamente ao sistema **Nexauren Tools**.

A área **Blog é intocável** durante qualquer trabalho de criação ou manutenção de ferramentas. Nenhuma ferramenta, migração, CSS, JavaScript, rota ou API de Tools pode alterar comportamento, conteúdo, estilos, estrutura ou dados de `blog_posts` sem uma tarefa específica e separada para o Blog.

## 2. Uma ferramenta é um produto funcional, não apenas um card

Uma ferramenta só é considerada criada quando existe:

- uma entrada válida na tabela `tools`;
- um `slug` único;
- um título;
- uma descrição curta e clara;
- uma categoria;
- uma rota funcional;
- uma implementação que realmente executa a função anunciada;
- estado de publicação coerente com o catálogo.

Nunca criar cards, links ou registros que apontem para uma ferramenta inexistente ou para uma página vazia.

## 3. Convenção de identificação

Cada ferramenta deve ter:

- `id`: identificador único;
- `slug`: único, estável e legível;
- `title`: nome apresentado ao utilizador;
- `description`: descrição objetiva;
- `category`: categoria principal;
- `route`: rota pública da ferramenta;
- `status`: `draft`, `published` ou `archived`.

Por convenção, a rota pública deve seguir:

`/tools/<slug>/`

O `slug` não deve ser alterado depois de a ferramenta ser publicada sem uma razão de compatibilidade claramente definida.

## 4. Estado de publicação

### draft
A ferramenta pode existir no Admin e no código, mas não deve aparecer como ferramenta utilizável no catálogo público.

### published
A ferramenta está implementada, testada e pronta para uso. Apenas ferramentas publicadas podem entrar no catálogo público, nas categorias, nos destaques ou nos resultados de pesquisa.

### archived
A ferramenta deixa de ser oferecida no catálogo público sem apagar necessariamente o seu histórico no banco de dados.

## 5. Catálogo e cache

O catálogo de Tools deve ser rápido e previsível.

Regra:

1. O frontend deve tentar carregar primeiro um catálogo válido em cache.
2. O cache deve permitir que a interface apresente imediatamente as ferramentas já conhecidas.
3. Depois da renderização inicial, o frontend pode consultar a fonte oficial em segundo plano.
4. O cache só deve ser atualizado quando houver alteração real no catálogo ou quando expirar segundo a política definida.
5. Uma ferramenta nova deve ser obtida da fonte oficial e então incorporada ao cache.
6. O frontend não deve permanecer indefinidamente preso em "A carregar categorias..." ou apresentar "0 ferramentas disponíveis" enquanto existe um catálogo válido em cache.

O catálogo oficial é a fonte de verdade. O cache é uma cópia de desempenho, nunca a fonte de verdade.

## 6. Categorias

Cada ferramenta deve pertencer a pelo menos uma categoria principal válida.

As categorias devem ser derivadas dos metadados reais das ferramentas. Não criar uma lista manual que fique divergente do catálogo.

Quando uma nova categoria for necessária, ela deve ser criada de forma consistente para que a pesquisa, os filtros e as páginas de categoria possam encontrá-la.

## 7. Pesquisa

A página de Tools deve permitir encontrar ferramentas pelo menos por:

- título;
- descrição;
- categoria;
- slug.

A pesquisa deve trabalhar sobre os dados já disponíveis no catálogo/cache e não deve exigir uma chamada de rede a cada tecla.

## 8. Free e Pro

Toda ferramenta que tenha limitação de plano deve declarar explicitamente o nível de acesso.

- **Free**: disponível sem assinatura Pro, respeitando eventuais limites específicos.
- **Pro**: exige plano Pro e deve apresentar indicação visual clara de bloqueio quando o utilizador não tiver acesso.

O bloqueio de uma ferramenta Pro deve existir no servidor sempre que houver operação protegida ou recurso pago. Esconder ou bloquear apenas no frontend não é considerado proteção suficiente.

Uma ferramenta não deve usar pagamentos avulsos improvisados como mecanismo de desbloqueio quando a regra de negócio definida para a plataforma for acesso por plano Pro.

## 9. Interface

Todas as ferramentas devem utilizar o sistema visual comum do Nexauren Tools.

Regras mínimas:

- responsividade real;
- bom funcionamento no telemóvel;
- áreas de toque adequadas;
- estados de carregamento, sucesso, erro e vazio;
- foco visível e navegação acessível;
- sem conflitos de scroll, menu ou overlays;
- sem camadas desnecessárias de CSS que criem estilos concorrentes.

Quando uma grade de ferramentas for usada, o layout móvel deve priorizar duas colunas sempre que o conteúdo permitir.

## 10. Implementação

Cada ferramenta deve manter separação entre:

- página/estrutura da ferramenta;
- lógica da ferramenta;
- estilos necessários.

Evitar duplicação de código. Componentes, funções, estilos e utilitários que sejam realmente comuns devem permanecer partilhados.

Não copiar um bloco inteiro de CSS ou JavaScript de outra ferramenta sem necessidade.

## 11. Registo administrativo

A criação administrativa deve seguir a API oficial de Tools.

O registro mínimo atual utiliza:

`POST /api/admin/tools`

com os campos necessários para título e rota e, quando aplicável:

- descrição;
- categoria.

A ferramenta deve começar em estado `draft` até estar pronta para publicação.

## 12. Banco de dados

A tabela `tools` é a fonte oficial de metadados do catálogo.

A estrutura atualmente existente deve ser respeitada, e qualquer novo atributo estrutural necessário para o sistema de Tools deve ser introduzido por migração versionada.

Não criar tabelas paralelas para o mesmo catálogo sem uma decisão arquitetural explícita.

## 13. Performance

Ferramentas devem abrir rapidamente e evitar trabalho desnecessário.

Preferências:

- carregar só o JavaScript necessário;
- evitar dependências pesadas quando uma solução nativa for suficiente;
- processar localmente quando isso for seguro e tecnicamente adequado;
- não fazer polling contínuo;
- não bloquear a interface esperando dados que podem ser obtidos em segundo plano.

## 14. Privacidade e segurança

Ficheiros ou dados do utilizador devem ser processados com o menor alcance possível.

Não expor segredos, credenciais ou dados de servidor no frontend.

Ferramentas Pro e qualquer operação sensível devem ter validação no servidor.

## 15. Compatibilidade com o restante Nexauren

Uma nova ferramenta não deve quebrar:

- Home;
- Conta;
- navegação global;
- autenticação;
- Admin;
- Books;
- outras ferramentas existentes.

Em particular, qualquer alteração feita para Tools deve ser isolada e não deve introduzir alterações colaterais no Blog.

## 16. Checklist obrigatório antes de publicar

Antes de mudar uma ferramenta para `published`, verificar:

- a rota abre diretamente;
- a função principal funciona;
- a ferramenta aparece no catálogo;
- a categoria aparece corretamente;
- a pesquisa encontra a ferramenta;
- o cache continua funcional;
- o estado Free/Pro está correto;
- o layout funciona no telemóvel e no desktop;
- loading/erro/sucesso estão tratados;
- não há erros de JavaScript;
- não há bloqueio de scroll/menu;
- nenhuma área do Blog foi alterada.

## 17. Regra de ouro

**Criar a ferramenta uma vez, registrar uma vez, publicar uma vez e fazer o catálogo descobri-la automaticamente.**

Não criar a mesma ferramenta manualmente em múltiplas listas, páginas ou catálogos independentes.
