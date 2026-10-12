# suspicious-views

API que classifica uma série de views por hora. Ela responde se a série parece audiência real, e explica o motivo em português. A regra é feita de três sinais simples. Não há modelo treinado.

## Rodar

Use Node 20 ou mais novo.

```bash
npm install
npm run dev        # http://127.0.0.1:3000
npm run dataset    # gera data/dataset.jsonl, mede e reescreve "Resultado medido"
npm test
npm run typecheck
```

`PORT` muda a porta.

## API

`POST /classify` recebe `views`: de 24 a 2160 inteiros não negativos, um por hora. A hora 0 é a primeira da série.

```bash
curl -X POST http://127.0.0.1:3000/classify -H 'content-type: application/json' \
  -d '{"views":[120,95,80,61,55,49,70,110,160,210,260,240,275,301,280,262,290,330,361,340,310,250,190,150,132,105,88,67,61,54,5077,5121,5176,5231,5286,5264,303,331,308,288,319,363,397,374,341,275,209,165]}'
```

```json
{
  "classification": "suspicious",
  "reason": "As views subiram 83,2x na hora 30 (de 61 para 5.077 por hora). Ficaram 6 horas nesse patamar. As views caíram 15,9x na hora 36 (de 5.264 para 331 por hora). Pico de audiência real perde força aos poucos. Este entrou e saiu de uma vez, como pacote de views comprado.",
  "signals": [
    {
      "name": "flat_run",
      "detected": false,
      "description": "Nenhuma sequência de 8 horas com números iguais demais.",
      "evidence": null
    },
    {
      "name": "sudden_rise",
      "detected": true,
      "description": "As views subiram 83,2x na hora 30 (de 61 para 5.077 por hora).",
      "evidence": { "hour": 30, "before": 61, "after": 5077, "factor": 83.22950819672131 }
    },
    {
      "name": "sudden_drop",
      "detected": true,
      "description": "As views caíram 15,9x na hora 36 (de 5.264 para 331 por hora).",
      "evidence": { "hour": 36, "before": 5264, "after": 331, "factor": 15.90332326283988 }
    }
  ]
}
```

A resposta sempre traz os três sinais, detectados ou não. Entrada inválida responde 400 com `error` e `message`.

## Critério

A regra está em [src/classifier.ts](src/classifier.ts).

| Sinal | Quando aparece |
| --- | --- |
| `flat_run` (números iguais demais) | 8 horas seguidas com média de 50 views ou mais e variância menor que 5% da média |
| `sudden_rise` (subida brusca) | As duas horas seguintes ficam 3x acima das duas anteriores, com diferença de 100 views ou mais |
| `sudden_drop` (queda brusca) | As duas horas seguintes ficam 3x abaixo das duas anteriores, com diferença de 100 views ou mais |

Audiência real é uma contagem de pessoas independentes. Nesse tipo de contagem a variância é pelo menos igual à média. Uma variância 20 vezes menor só aparece quando alguém entrega uma cota fixa por hora.

Um pico vira "caixa" quando a queda brusca vem depois da subida brusca e o patamar ainda estava em pelo menos metade da altura da subida. Pico real perde força aos poucos. Pico comprado acaba quando o pacote acaba.

| Sinais | Classificação |
| --- | --- |
| Números iguais demais, ou pico em caixa | `suspicious` |
| Subida brusca sem caixa, queda brusca sem caixa, ou as duas fora de ordem | `inconclusive` |
| Nenhum sinal | `legitimate` |

`legitimate` quer dizer que nenhum sinal apareceu. Não é prova de que as views são reais.

## Um caso em que ele prefere não acusar

Um perfil grande compartilha o vídeo. As views sobem 60x em uma hora e caem aos poucos nas horas seguintes. A subida é igual à de um pico comprado. A queda não é. O classificador responde `inconclusive`:

> As views subiram 62,6x na hora 30 (de 61 para 3.821 por hora). Depois disso não houve queda brusca. Subida rápida com queda gradual acontece quando o vídeo é compartilhado por um perfil grande. Não há evidência suficiente para acusar.

O mesmo vale para uma queda brusca sozinha (vídeo removido, falha de coleta). Os testes estão em [test/classifier.test.ts](test/classifier.test.ts), no bloco "prefere não acusar". O teste "pico orgânico da mesma altura" compara um pico orgânico e um comprado com o mesmo máximo de 5.286 views por hora.

## Resultado medido

Esta seção é escrita por `npm run dataset`. Não edite à mão.

- Taxa de falso positivo: **2,33%** (14 de 600 séries legítimas classificadas como `suspicious`).
- Intervalo de 95% da taxa (Wilson): 1,39% a 3,88%.
- Séries legítimas sem acusação e sem absolvição (`inconclusive`): 16,17% (97 de 600).
- Séries suspeitas detectadas: 85,00% (340 de 400).

| Rótulo | Cenário | Séries | `legitimate` | `inconclusive` | `suspicious` |
| --- | --- | ---: | ---: | ---: | ---: |
| legitimate | `steady` | 210 | 210 | 0 | 0 |
| legitimate | `organic_viral` | 180 | 175 | 5 | 0 |
| legitimate | `new_video` | 90 | 90 | 0 | 0 |
| legitimate | `sudden_share` | 48 | 3 | 45 | 0 |
| legitimate | `collection_gap` | 36 | 9 | 27 | 0 |
| legitimate | `scheduled_event` | 36 | 2 | 20 | 14 |
| suspicious | `bought_plateau` | 140 | 0 | 0 | 140 |
| suspicious | `bought_jittered` | 80 | 0 | 0 | 80 |
| suspicious | `mechanical_flat` | 80 | 0 | 0 | 80 |
| suspicious | `daily_blocks` | 40 | 0 | 0 | 40 |
| suspicious | `drip_feed` | 36 | 36 | 0 | 0 |
| suspicious | `small_boost` | 24 | 24 | 0 | 0 |

### Seeds

- Os números acima são da seed 314159, gerada depois que os limiares estavam fixos.
- Na seed 20261011, usada para ajustar os limiares: falso positivo de 1,50% (9 de 600) e detecção de 85,00% (340 de 400).
- Nas 20 seeds de 101 a 120: falso positivo de 0,67% a 2,33% e detecção de 84,75% a 85,25%.

### Custo de acusar por qualquer sinal

| Regra | Legítimas acusadas | Suspeitas detectadas |
| --- | ---: | ---: |
| Qualquer sinal acusa | 111 de 600 | 340 de 400 |
| Números iguais demais ou pico em caixa (regra usada) | 14 de 600 | 340 de 400 |

### Custo por limiar

Medido na seed 20261011, a de ajuste. Cada linha muda um limiar e mantém os outros no valor usado. Falso positivo é série legítima classificada como `suspicious`. Falso negativo é série suspeita que não foi classificada como `suspicious`.

| Limiar | Valor | Falsos positivos | Falsos negativos |
| --- | --- | ---: | ---: |
| Horas seguidas de `flat_run` | 6 horas | 10 de 600 (1,67%) | 60 de 400 (15,00%) |
| Horas seguidas de `flat_run` | **8 horas (usado)** | 9 de 600 (1,50%) | 60 de 400 (15,00%) |
| Horas seguidas de `flat_run` | 12 horas | 9 de 600 (1,50%) | 60 de 400 (15,00%) |
| Variância máxima de `flat_run` | 2% da média | 9 de 600 (1,50%) | 62 de 400 (15,50%) |
| Variância máxima de `flat_run` | **5% da média (usado)** | 9 de 600 (1,50%) | 60 de 400 (15,00%) |
| Variância máxima de `flat_run` | 10% da média | 9 de 600 (1,50%) | 60 de 400 (15,00%) |
| Variância máxima de `flat_run` | 20% da média | 13 de 600 (2,17%) | 60 de 400 (15,00%) |
| Fator de subida e de queda | 2x | 20 de 600 (3,33%) | 58 de 400 (14,50%) |
| Fator de subida e de queda | **3x (usado)** | 9 de 600 (1,50%) | 60 de 400 (15,00%) |
| Fator de subida e de queda | 4x | 3 de 600 (0,50%) | 60 de 400 (15,00%) |
| Fator de subida e de queda | 5x | 1 de 600 (0,17%) | 64 de 400 (16,00%) |
| Patamar mínimo antes da queda | 25% da subida | 9 de 600 (1,50%) | 60 de 400 (15,00%) |
| Patamar mínimo antes da queda | **50% da subida (usado)** | 9 de 600 (1,50%) | 60 de 400 (15,00%) |
| Patamar mínimo antes da queda | 75% da subida | 9 de 600 (1,50%) | 60 de 400 (15,00%) |

## Como ler a taxa

Os testes em [test/dataset.test.ts](test/dataset.test.ts) medem o dataset commitado e comparam com a seção acima. Se um número do README divergir do medido, o teste falha.

A taxa é uma propriedade deste dataset. Ela não estima o erro em tráfego real. O intervalo de 95% mostra a precisão que 600 séries legítimas permitem.

A taxa publicada vem de uma seed que os limiares não viram. Eu ajustei o limiar de `flat_run` olhando a seed de ajuste e as seeds de 1 a 20. O primeiro limiar (6 horas, 10% da média) acusava por acaso 7 séries honestas em 600 na seed de ajuste. Com 8 horas e 5%, nenhuma nessas 21 seeds. Essa comparação entre os dois limiares foi feita por um script fora do repositório. A seed publicada e as seeds de comparação foram escolhidas depois, e os limiares não mudaram desde então.

Na tabela acima, todos os falsos positivos estão em um cenário: `scheduled_event`. Um teste confere isso. É um evento legítimo com hora marcada (uma live, um programa de TV) que multiplica as views por algumas horas e acaba de uma vez. Na série de views ele tem a mesma forma de um pacote comprado. O cenário é 6% das séries legítimas, e esse 6% fui eu que escolhi. Com mais eventos assim no gerador, a taxa sobe na mesma proporção.

A tabela "Custo de acusar por qualquer sinal" compara a regra usada com a regra mais simples, em que uma subida ou uma queda brusca sozinha já acusa. As linhas `drip_feed` e `small_boost` mostram por quê a detecção não muda: essas séries não disparam sinal nenhum.

## O que ele não detecta

- Views compradas entregues aos poucos, com subida e descida suaves (linha `drip_feed` da tabela).
- Pico comprado menor que 3x a audiência normal (linha `small_boost` da tabela).
- Pico comprado de uma hora só. A mudança precisa durar duas horas.
- Bots com variação parecida com a de gente e sem borda brusca.
- Vídeo com menos de 50 views por hora. O volume é baixo demais para separar entrega automática de acaso.
- Subida ou queda nas duas primeiras horas e na última hora da série. Faltam horas vizinhas para comparar.
- De onde vêm as views. A série não tem origem, retenção, curtidas nem comentários.

Ele também erra para o outro lado: evento legítimo com fim brusco é acusado (linha `scheduled_event` da tabela).

## Dataset

[data/dataset.jsonl](data/dataset.jsonl) tem 1.000 séries de 168 horas, uma por linha, com `id`, `label`, `scenario` e `views`. O gerador está em [src/dataset.ts](src/dataset.ts). Ele usa um gerador de números aleatórios próprio com seed fixa, então o arquivo sai idêntico a cada execução. Um teste confere isso.

A audiência orgânica tem ciclo diário, ruído proporcional ao volume e contagem de Poisson. As views de bot são somadas por cima, sem ruído ou com o ruído do cenário.

| Cenário | O que simula |
| --- | --- |
| `steady` | Vídeo antigo com audiência estável |
| `organic_viral` | Viralização que sobe em 4 a 12 horas e cai em dias |
| `new_video` | Vídeo recém-publicado |
| `sudden_share` | Compartilhamento por perfil grande: subida em uma hora, queda gradual |
| `collection_gap` | Vídeo removido ou horas sem coleta |
| `scheduled_event` | Evento legítimo com hora para começar e acabar |
| `bought_plateau` | Pacote comprado entregue a taxa constante |
| `bought_jittered` | Pacote comprado com variação de 10% por hora |
| `mechanical_flat` | Vídeo quase sem audiência com a mesma quantidade de bots toda hora |
| `daily_blocks` | O mesmo bloco de views comprado todo dia no mesmo horário |
| `drip_feed` | Views compradas entregues aos poucos, com ruído |
| `small_boost` | Pacote comprado pequeno, do tamanho da audiência normal |

## Código

`classifier.ts` tem os sinais e a decisão. `dataset.ts` tem o gerador. `evaluation.ts` mede o dataset e escreve o relatório. `generate.ts` é o comando. `schemas.ts` tem o formato da requisição. `app.ts` tem a rota.

## O que ficou de fora

- Autenticação.
- Persistência. A API não guarda série nem veredito.
- Classificação em lote.
- Limiares configuráveis por requisição.
- Hora do dia e fuso. A série não tem data.

## Uso de IA

O Claude Code (Claude Opus 5.5) escreveu o código, os testes, o dataset e este README. Ele também escolheu os sinais, os limiares e os cenários do dataset.

Eu escolhi TypeScript e pedi a entrega. Depois li o código em `src/`, os testes e este README, na primeira versão.

Depois pedi quatro mudanças na medição: publicar a taxa de uma seed que os limiares não viram, trazer a faixa entre seeds para o comando, mostrar o intervalo de 95% e comparar a regra com "qualquer sinal acusa". Reli o código dessas mudanças em `src/evaluation.ts` e os testes novos.
