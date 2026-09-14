# Amazon Connect & Amazon Lex Configuration & Architectural Analysis Report

**Role:** Expert Cloud Architect & UI Analyst  
**Environment:** Amazon Connect Contact Flow & Amazon Lex Conversational AI Console  
**Scope:** Complete reverse-engineering and field-level UI mapping across all 48 console screenshots.

---

## 1. Amazon Lex Conversational AI Bot (`agent-selfservice-lf`)

### Console Context & Navigation
* **Breadcrumbs:** `Conversational AI > Edit`
* **Main Entity Name:** `agent-selfservice-lf`
* **Sub-title / Description:** Personalize your conversational AI bot
* **Available Navigation Tabs:** `Details`, `[ACTIVE] Configuration`, `Analytics`, `Aliases`, `Versions`
* **Header Actions:** **Advanced configurations**, **Create versions**

---

### Tab 1: Configuration `[ACTIVE]`

#### Section: Define your Conversational AI bot
* **Description:** Add supported languages, user Intents, and how your Conversational AI bot handles user inputs.
* **Header Actions:** **Add language** dropdown button.
* **Active Language Chip:** `English (US)` `[Built]` (with remove option).

#### Section: Configure your supported language
* **Status Alert Banner:** `English (US) has unbuilt changes` (Warning state).
* **Action Button:** **Build language**.
* **Description:** Define how your Conversational AI bot interacts with users including what intents your Conversational AI bot can support, what information needs to be gathered from users, and what messages the Conversational AI bot plays when interacting with users.

#### UI Card: Confidence score threshold
* **Element Name:** **Confidence score threshold**
* **Action Button:** **Edit**
* **Selected Value:** `0.4` (Scale range: `0` to `1`)
* **Description:** The confidence score threshold determines how confident the model should be in determining the user's intent.

#### UI Card: Amazon Connect AI agent in Connect intent
* **Element Name:** **Amazon Connect AI agent Intent**
* **Element State:** `Disabled` toggle
* **Info Alert Banner:** `Amazon Connect AI agent is not supported for the Conversational AI bot created outside Connect console, Please go to Lex console to add Amazon Connect AI agent configuration`

#### UI Card: Speech model
* **Element Name:** **Speech-to-Text**
* **Action Button:** **Edit**
* **Selected Value:** `Amazon`

#### Section: Intent
* **Header Action:** **Add intent** dropdown button.
* **Intent Selection:**
  * `(x) FallbackIntent` `[ACTIVE]`
  * `( ) TrumpAccountIntent` (Available unselected)
* **Card: Details**
  * **Intent Name:** `FallbackIntent`
  * **Info Alert Banner:** `Built in intents don't contain slots or context tags. The utterances can't be viewed or edited.`
* **Card: Prompts**
  * **Initial response message:** `Okay, I can help you with that`
  * **Closing response message:** `Inactive` (Configured text: `Thanks!`)
* **Card: Additional Conversational AI bot configuration**
  * **Fulfillment:** `Enabled`
  * **Code Hooks:** `Disabled`
  * **Input Context:** `Disabled`
  * **Output Context:** `Disabled`

---

### Tab 2: Analytics `[ACTIVE]`

* **Control Bar:** Time range selectors (`1d`, `[ACTIVE] 1w`, `1m`), `Custom` date filter, `All languages`, `All aliases`, `All versions`.
* **Card: Conversation performance**
  * **Total Conversations:** `11`
  * **Success Rate:** `7 conversations, 64%`
  * **Failed Rate:** `4 conversations, 36%`
* **Card: Utterance recognition rate**
  * **Total Utterances:** `11`
  * **Detected Rate:** `7 utterances, 64%`
  * **Missed Rate:** `4 utterances, 36%`
* **Card: Conversation performance history**
  * **Metrics timeline:** UTC axis `9/8 00:00` to `9/13 12:00` tracking conversation volume and success ratios.

---

### Tab 3: Aliases `[ACTIVE]`

* **Header:** **Aliases (2)** | Action: **Create aliases**
* **Table Mapping:**

| Alias | Description | Associated Version | Use in Flow & Modules | Last Modified |
| :--- | :--- | :--- | :--- | :--- |
| `connect` | `-` | `7` | `Enabled` (Toggle ON) | `09/01/26, 10:53:13 AM UTC` |
| `TestBotAlias` | `test bot alias` | `DRAFT` | `Disabled` (Toggle OFF) | `08/26/26, 06:47:18 AM UTC` |

---

### Tab 4: Versions `[ACTIVE]`

* **Header:** **Versions (8)** | Action: **Create versions**
* **Version Inventory:**
  * **Version 7:** Associated aliases: `connect` | Created: `09/01/26, 10:53:01 AM UTC`
  * **Version 6:** Associated aliases: `-` | Created: `09/01/26, 06:55:32 AM UTC`
  * **Version 5:** Associated aliases: `-` | Created: `08/27/26, 06:01:25 PM UTC`
  * **Version 4:** Associated aliases: `-` | Created: `08/27/26, 11:48:37 AM UTC`
  * **Version 3:** Associated aliases: `-` | Created: `08/27/26, 09:58:30 AM UTC`
  * **Version 2:** Associated aliases: `-` | Created: `08/26/26, 06:56:42 AM UTC`
  * **Version 1:** Associated aliases: `-` | Created: `08/26/26, 06:47:57 AM UTC`
  * **Version DRAFT:** Description: `Invest America Trump Account voice bot` | Associated aliases: `TestBotAlias` | Created: `08/26/26, 06:47:06 AM UTC`

---

## 2. Amazon Connect Contact Flow Blocks Configuration

---

### Block 1: Entry Block
* **Block Header:** `➔ Entry`
* **Tabs Available:** `Config`, `Connections`, `Notes`
* **Description:** "This is where your flow begins."
* **Connections Tab:**
  * **Branch `Start`:** Target Block -> `Set logging behavior`.
  * **Available unselected target options:** `Add a new block`, `Disconnect this branch`, `AWS Lambda function (arn:aws:lambda:us-east-1:439093223885:function:Trascript-Escalate-5833)`, `Check contact attributes`, `Connect assistant`, `Disconnect`, `Get customer input`, `Play prompt`.

---

### Block 2: Set Logging Behavior
* **Block Header:** `Set logging behavior`
* **Description:** "When logging is enabled, data for each block in your flow is sent to Amazon CloudWatch Logs."
* **Config Tab:**
  * **Logging Behavior:** `(x) Enabled` **(Selected)** | `( ) Disabled` (Unselected).
* **Connections Tab:**
  * **Branch `Success`:** Target Block -> `Set recording, analytics, and processing behavior`.
  * **Incoming Blocks:** `Entry` (Branch: `Start`).

---

### Block 3: Connect Assistant (Instance 1 — AI Agent Domain Association)
* **Block Header:** `Connect assistant`
* **Description:** "Associates a Connect AI agent to a contact to enable real-time recommendations and assistance for your employees."
* **Config Tab:**
  * **Select a Domain:** `(x) Set manually` **(Selected)**.
  * **Domain ARN Value:** `arn:aws:wisdom:us-east-1:439093223885:assistant/cc98d2ff-8bc2-4a29-8fac-dee7b4e5d02b`.
* **Connections Tab:**
  * **Branch `Success`:** Target Block -> `Set contact attributes`.
  * **Branch `Error`:** Target Block -> `Play prompt`.
  * **Incoming Blocks:** `Set recording, analytics, and processing behavior`.

---

### Block 4: Set Contact Attributes (Instance 1 — Customer Identity)
* **Block Header:** `Set contact attributes`
* **Description:** "Define and store key-value pairs as contact attributes."
* **Config Tab:**
  * **Set Attributes On:** `Current contact` (Unselected: `Related contact`, `Flow`).
  * **Attribute 1:**
    * **Namespace:** `User defined` (Unselected: `System`, `Segment attributes`).
    * **Key:** `CustomerName`
    * **Value Selection:** `(x) Set manually` **(Selected)** ➔ `John`.
* **Connections Tab:**
  * **Branch `Success`:** Target Block -> `Set voice`.
  * **Branch `Error`:** Target Block -> `Set voice`.
  * **Incoming Blocks:** `Connect assistant` (Instance 1).

---

### Block 5: Set Voice (TTS Engine & Style)
* **Block Header:** `Set voice`
* **Config Tab:**
  * **Voice Provider:** `Amazon` (Unselected: `Amazon Connect agentic voice`, `Deepgram`, `ElevenLabs`).
  * **Language:** `(x) Set manually` ➔ `English (United States)`.
  * **Voice:** `(x) Set manually` ➔ `Matthew`.
  * **Speaking Style:** `[x] Override speaking style - Neural: Conversational` **(Checked)**.
  * **Engine:** `( ) Standard (Legacy)`, `( ) Neural speaking style`, `(x) Generative` **(Selected)**.
* **Connections Tab:**
  * **Branch `Success`:** Target Block -> `Play prompt`.
  * **Branch `Error`:** Target Block -> `Play prompt`.
  * **Incoming Blocks:** `Set contact attributes` (Instance 1).

---

### Block 6: Play Prompt (Recording Disclosure)
* **Block Header:** `Play prompt`
* **Config Tab:**
  * **Prompt Source:** `(x) Text-to-speech or chat text` **(Selected)**.
  * **Text Input Mode:** `(x) Set manually` **(Selected)**.
  * **SSML Content:**
    ```xml
    <speak>
      <prosody rate="90%">
        This call will be monitored and recorded, and your voice may be used for verification.
      </prosody>
    </speak>
    ```
  * **Interpret as:** `SSML`.
* **Connections Tab:**
  * **Branch `Success`:** Target Block -> `Connect assistant` (Instance 2).
  * **Branch `Error`:** Target Block -> `Connect assistant` (Instance 2).
  * **Incoming Blocks:** `Set voice`.

---

### Block 7: Connect Assistant (Instance 2 — Real-time Agent Assistance)
* **Block Header:** `Connect assistant`
* **Config Tab:**
  * **Select a Domain:** `(x) Set manually` ➔ `arn:aws:wisdom:us-east-1:439093223885:assistant/cc98d2ff-8bc2-4a29-8fac-dee7b4e5d02b`.
* **Connections Tab:**
  * **Branch `Success`:** Target Block -> `Get customer input`.
  * **Branch `Error`:** Target Block -> `Play prompt`.
  * **Incoming Blocks:** `Play prompt` (Recording Disclosure).

---

### Block 8: Get Customer Input (Lex Bot: Trump Accounts)
* **Block Header:** `Get customer input`
* **Config Tab:**
  * **Input Mode Tab:** `[ACTIVE] Amazon Lex`.
  * **Lex Bot Selection:** `(x) Enter an ARN` ➔ `(x) Set manually` ➔ `arn:aws:lex:us-east-1:439093223885:bot-alias/VXP2B8RZED/EGR6IRTLPQ`.
  * **Customer Prompt SSML:**
    ```xml
    <speak>
      <break time="300ms"/>
      I can help you with general information about Trump Accounts, like who qualifies for an account, how to open one, or how much you can contribute.
      <break time="400ms"/>
      Now, How can I help you today?
    </speak>
    ```
  * **Session Attributes (3 Key-Value Pairs):**
    1. `x-amz-lex:audio:end-timeout-ms:*:*` = `2500`
    2. `x-amz-lex:audio:locale-override:ms:*:*` = `en-US`
    3. `x-amz-lex:q-in-connect:ai-agent-arn` = `arn:aws:wisdom:us-east-1:439093223885:assistant/cc98d2ff-8bc2-4a29-8fac-dee7b4e5d02b`
* **Connections Tab:**
  * **Branch `Default`:** Target Block -> `Check contact attributes`.
  * **Branch `Error`:** Target Block -> `Play prompt`.
  * **Incoming Blocks:** `Connect assistant` (Instance 2).

---

### Block 9: Check Contact Attributes (Lex Action Evaluation)
* **Block Header:** `Check contact attributes`
* **Config Tab:**
  * **Condition Type:** `Single Condition`.
  * **Attribute Namespace:** `Lex` | **Key:** `Session attributes` | **Session Attribute Key:** `Tool`.
  * **Conditions:**
    * **Condition 1:** `Equals` `Escalate`
    * **Condition 2:** `Equals` `Complete`
* **Connections Tab:**
  * **Branch `= Escalate`:** Target Block -> `Set contact attributes` (Instance 2).
  * **Branch `= Complete`:** Target Block -> `Disconnect`.
  * **Branch `No Match`:** Target Block -> `Play prompt`.
  * **Incoming Blocks:** `Get customer input`.

---

### Block 10: Set Contact Attributes (Instance 2 — Escalation Context)
* **Block Header:** `Set contact attributes`
* **Config Tab:**
  * **Set Attributes On:** `Current contact`.
  * **Attributes Configured (4 User defined keys):**
    1. `escalationReason` = `$.Lex.SessionAttributes.escalationReason`
    2. `escalationSummary` = `$.Lex.SessionAttributes.escalationSummary`
    3. `customerIntent` = `$.Lex.SessionAttributes.customerIntent`
    4. `sentiment` = `$.Lex.SessionAttributes.sentiment`
* **Connections Tab:**
  * **Branch `Success`:** Target Block -> `AWS Lambda function`.
  * **Branch `Error`:** Target Block -> `AWS Lambda function`.
  * **Incoming Blocks:** `Check contact attributes` (`= Escalate`).

---

### Block 11: AWS Lambda Function (`Trascript-Escalate-5833`)
* **Block Header:** `AWS Lambda function`
* **Config Tab:**
  * **Function ARN:** `(x) Set manually` ➔ `arn:aws:lambda:us-east-1:439093223885:function:Trascript-Escalate-5833`.
  * **Execution Mode:** `(x) Synchronous mode`.
  * **Function Parameters (6 Key-Value Pairs):**
    1. `escalationReason` = `$.Attributes.escalationReason`
    2. `escalationSummary` = `$.Attributes.escalationSummary`
    3. `customerIntent` = `$.Attributes.customerIntent`
    4. `sentiment` = `$.Attributes.sentiment`
    5. `ConfidenceScore` = `$.Lex.IntentConfidence.Score`
    6. `Trans` = `$.Lex.SessionAttributes.transcript`
  * **Timeout:** `3` seconds.
  * **Response Validation:** `(x) STRING MAP`.
* **Connections Tab:**
  * **Branch `Success`:** Target Block -> `Set working queue`.
  * **Branch `Error`:** Target Block -> `Set working queue`.
  * **Incoming Blocks:** `Set contact attributes` (Instance 2).

---

### Block 12: Set Working Queue (`invest-america-queue`)
* **Block Header:** `Set working queue`
* **Config Tab:**
  * **Queue Selection:** `(x) By queue` ➔ `(x) Set manually` ➔ `invest-america-queue`.
* **Connections Tab:**
  * **Branch `Success`:** Target Block -> `Transfer to queue`.
  * **Branch `Error`:** Target Block -> `Transfer to queue`.
  * **Incoming Blocks:** `AWS Lambda function`.

---

### Block 13: Transfer to Queue
* **Block Header:** `Transfer to queue`
* **Config Tab:**
  * **Transfer Mode Tab:** `[ACTIVE] Transfer to queue`.
* **Connections Tab:**
  * **Branch `At capacity`:** Target Block -> `Disconnect`.
  * **Branch `Error`:** Target Block -> `Disconnect`.
  * **Incoming Blocks:** `Set working queue`.

---

### Block 14: Disconnect
* **Block Header:** `Disconnect`
* **Config Tab:**
  * **Description:** "End the interaction."
* **Connections Tab:**
  * **Outgoing Branches:** None.
  * **Incoming Blocks:**
    1. `Check contact attributes` (`= Complete`)
    2. `Transfer to queue` (`At capacity` / `Error`)
    3. `Play prompt` (`Error prompt`)

---

## 3. Contact Flow Execution Diagram

```
[Entry Block] 
     │
     ▼ (Start)
[Set logging behavior] ──(Success)──► [Connect assistant (Instance 1)]
                                              │
                                              ▼ (Success)
                                    [Set contact attributes (CustomerName)]
                                              │
                                              ▼ (Success/Error)
                                    [Set voice (Matthew / Generative)]
                                              │
                                              ▼ (Success)
                                    [Play prompt (Recording SSML)]
                                              │
                                              ▼ (Success/Error)
                                    [Connect assistant (Instance 2)]
                                              │
                                              ▼ (Success)
                                    [Get customer input (Lex Bot)]
                                              │
                                              ▼ (Default)
                                    [Check contact attributes (Lex Tool)]
                                      ├── (= Escalate) ──► [Set contact attributes (Escalation)]
                                      │                          │
                                      │                          ▼ (Success/Error)
                                      │                    [AWS Lambda (Trascript-Escalate-5833)]
                                      │                          │
                                      │                          ▼ (Success/Error)
                                      │                    [Set working queue (invest-america-queue)]
                                      │                          │
                                      │                          ▼ (Success/Error)
                                      │                    [Transfer to queue]
                                      │                          │
                                      │                          ▼ (At capacity / Error)
                                      ├── (= Complete) ──────────► [Disconnect]
                                      └── (No Match) ────────────► [Play prompt (Error)] ──► [Disconnect]
```
