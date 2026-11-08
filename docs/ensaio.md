# Roteiro do ensaio com dados reais

Objetivo: percorrer a plataforma como no dia a dia, com terminais, pessoas, transitários e documentos reais,
e anotar tudo o que falha, confunde ou falta **antes** de apresentar ao cliente.

O ensaio corre numa **base de dados e numa pasta de ficheiros próprias** (`sogester_ensaio` e `server/uploads-ensaio`).
Os dados de desenvolvimento ficam intactos e o ensaio pode ser apagado no fim.

---

## 0. Preparação (uma vez)

1. **Dar acesso à base de ensaio** ao utilizador `sogester` (no HeidiSQL do Laragon, ou na consola do MySQL, como `root`):

   ```sql
   GRANT ALL PRIVILEGES ON `sogester_ensaio`.* TO 'sogester'@'localhost';
   ```

2. **Parar a API normal** e arrancar a do ensaio (na pasta `server`):

   ```bash
   npm run ensaio
   ```

   A consola deve mostrar `ENSAIO — base sogester_ensaio`. O frontend (`npm run dev` na pasta `web`) não muda.

3. **Inicializar o administrador geral**: abrir `http://localhost:5173/setup`, indicar o `SETUP_TOKEN` (está no `server/.env`),
   o nome, o e-mail real e uma palavra-passe forte. Depois disto o setup fecha para sempre nesta base.

> Se esquecer a palavra-passe do administrador geral do ensaio, na pasta `server` (PowerShell):
> `$env:DB_NAME='sogester_ensaio'; npm run admin:reset-password`

---

## 1. Como anotar os problemas

Para cada problema, uma linha: **passo · perfil · o que fez · o que esperava · o que aconteceu**, com captura de ecrã se possível.
Classifique: **Bloqueia** (não deixa continuar), **Errado** (resultado incorreto), **Confuso** (funciona mas não se percebe), **Falta** (algo que o processo real precisa).

---

## 2. Administrador geral

| # | Fazer | Verificar | OK? | Notas |
|---|---|---|---|---|
| 2.1 | **Terminais**: ativar Cabinda, Soyo e Luanda; criar os outros terminais reais | Os novos nascem inativos e só ficam disponíveis depois de ativados | | |
| 2.2 | **Funcionários**: criar o administrador de cada terminal | Cada um entra e vê só o seu terminal | | |
| 2.3 | (Opcional) Dar «Gere terminais» a um funcionário | Essa pessoa passa a ver o menu Terminais | | |

## 3. Administrador de cada terminal

| # | Fazer | Verificar | OK? | Notas |
|---|---|---|---|---|
| 3.1 | Criar a equipa: Loja, Finanças de processos, Chefe comercial, Portaria (e Cadastro, se usarem) | Cada perfil vê só o menu que lhe cabe; a Portaria só vê o ecrã Portaria | | |
| 3.2 | Registar 2 ou 3 transitários reais (NIF, e-mail, utilizador) | O transitário recebe acesso e aparece «Pendente» até ser aprovado | | |
| 3.3 | Noutro terminal, **vincular pelo NIF** um transitário já registado e aprovar | O mesmo transitário fica com dois terminais | | |

## 4. Transitário — entrada e submissão

| # | Fazer | Verificar | OK? | Notas |
|---|---|---|---|---|
| 4.1 | Entrar com um transitário aprovado em **um** terminal | Entra direto nesse terminal | | |
| 4.2 | Entrar com um transitário aprovado em **dois** terminais | Aparece «Escolha o terminal»; o menu mostra o terminal e «Trocar de terminal» | | |
| 4.3 | Novo processo de **desembarque**: EP17, recibo do EP17 e documentação da JUP (vários ficheiros de uma vez) | Pede só esses três; a referência sai com o prefixo do terminal | | |
| 4.4 | Novo processo de **embarque** com EP15 | O formulário troca para EP15 | | |
| 4.5 | Carga real: contentores, veículos com chassi e carga mista (ex.: carga geral dentro de um carro) | Listas, totais por pés e «transportada em» corretos | | |
| 4.6 | Pedir urgência num processo | A Loja vê-o primeiro na fila | | |

## 5. Loja — análise e correções

| # | Fazer | Verificar | OK? | Notas |
|---|---|---|---|---|
| 5.1 | Abrir o processo, ver os documentos no visualizador | Os PDF e imagens reais abrem e descarregam bem | | |
| 5.2 | Pedir correções: um documento recusado, um em falta, um campo errado | O transitário vê só esses pontos, cada um com o motivo | | |
| 5.3 | Transitário corrige (envia em «Outros» o que falta) e reenvia | Não deixa reenviar com pontos por corrigir; o histórico regista tudo | | |
| 5.4 | Marcar os documentos conformes | Já não se pode cancelar o processo | | |
| 5.5 | Carregar a **proforma real** gerada no 1C (só o ficheiro é obrigatório) | O transitário recebe aviso e vê/descarrega a proforma | | |

## 6. Pagamento, Finanças e conclusão

| # | Fazer | Verificar | OK? | Notas |
|---|---|---|---|---|
| 6.1 | Transitário: «Já paguei» com o comprovativo real | Sem comprovativo não avança | | |
| 6.2 | Finanças: comparar comprovativo e proforma lado a lado e **recusar** uma vez com motivo | O transitário vê o motivo e envia outro | | |
| 6.3 | Finanças: confirmar e carregar a **Factura/Recibo real** | O processo conclui sozinho e vai para Arquivados | | |
| 6.4 | Transitário: abrir Arquivados | Vê o processo concluído e descarrega a Factura/Recibo | | |

## 7. Saída antecipada e Portaria

| # | Fazer | Verificar | OK? | Notas |
|---|---|---|---|---|
| 7.1 | Chefe comercial: emitir saída antecipada com um motivo real | O transitário recebe aviso para aceitar o compromisso | | |
| 7.2 | Transitário: ler os termos e aceitar com a palavra-passe | Só depois aparece «Ver e imprimir autorização» | | |
| 7.3 | Imprimir a autorização | Logótipo, dados do processo e da carga, motivo, código e QR Code legíveis no papel | | |
| 7.4 | Portaria: ler o QR Code **com o telemóvel** e registar a saída | Mostra a carga certa; regista uma vez | | |
| 7.5 | Tentar usar a mesma autorização outra vez | Recusada: «Já usada» | | |
| 7.6 | Loja: carregar a proforma com **data limite** de pagamento | Passado o prazo, o processo fica em incumprimento e há avisos | | |

## 8. Mensagens, avisos e separação

| # | Fazer | Verificar | OK? | Notas |
|---|---|---|---|---|
| 8.1 | Trocar mensagens no processo (Loja ↔ transitário), com anexo | Contadores de não lidas certos | | |
| 8.2 | Ver o sino de avisos de cada perfil | Avisos certos para cada passo | | |
| 8.3 | Funcionário de um terminal tenta abrir processo de outro (pelo endereço) | «Processo não encontrado» | | |
| 8.4 | Transitário em Soyo tenta ver um processo de Cabinda | «Processo não encontrado»; precisa de trocar de terminal | | |

## 9. Relatórios

| # | Fazer | Verificar | OK? | Notas |
|---|---|---|---|---|
| 9.1 | Administrador do terminal: Processos, Receita e Atrasos | Números batem com o que se fez no ensaio | | |
| 9.2 | Administrador geral: separador Terminais | Comparação lado a lado certa; CSV abre bem no Excel | | |

---

## 10. Depois do ensaio

1. Parar a API do ensaio (`Ctrl+C`) e voltar à normal com `npm start`.
2. Juntar as notas e rever comigo: cada problema vira uma correção, por ordem de gravidade.
3. Para recomeçar o ensaio do zero (apaga **só** o ensaio, não se recupera):

   ```sql
   DROP DATABASE `sogester_ensaio`;
   ```

   e apagar a pasta `server/uploads-ensaio`.
