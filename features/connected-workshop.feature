Feature: An attendee prepares an at-risk renewal across Mastra, Elastic, and Arcade

  Northwind ACC-2291 buys B2B identity and access software at a 12000 USD annual list price.
  Renewal is October 31; seats fell 220 to 140 and monthly sign-ins 85000 to 42000.
  SCIM case CS-1042 remains open; its relation to the decline and a fix date are unverified.
  Dana may offer a 15% discount; the requested 30% discount needs Riley's 40% authority.
  One attendee plays distinct seeded OAuth identities and receives the app's notification
  in their own delegated Slack self-DM. Sales is the single custom toolkit; approvals
  belong to the web app and hooks. The offer and follow-up email remain local drafts.
  The agent supplies a customer message that Riley reviews with the exact terms.
  The @live scenario requires separately retained cloud evidence. Local connected tests
  use a scripted model and do not establish live-model behavior or attendee timing.

  @connected-workshop.ATT1.R1 @surface.workshop-web
  Rule: connected-workshop.ATT1.R1 — Each stage runs with its own prerequisites
    Scenario: Start the attendee's agent before connecting cloud tools
      Given the model is available and no Arcade or Elastic credentials are configured
      When the attendee submits the supplied Northwind question through the agent API
      Then the response identifies supplied facts and missing evidence without a tool call

    Scenario Outline: The selected stage controls tools offered to the same agent
      Given one configured gateway exposes native Elastic search and the single Sales toolkit
      When the attendee opens the same agent in the <stage> stage
      Then the model is offered exactly the configured <tools> toolset
      Examples:
        | stage    | tools             |
        | Elastic  | Elastic           |
        | governed | Elastic and Sales |

    @rejection
    Scenario: A required gateway is unavailable
      Given the attendee has selected the Elastic stage and its gateway cannot be reached
      When the attendee submits the saved question through the agent API
      Then the response is an explicit connection failure without a supplied-input answer

  @connected-workshop.ATT1.R2 @surface.gateway @surface.workshop-web
  Rule: connected-workshop.ATT1.R2 — Connected evidence comes through the same gateway
    Scenario: Retrieve the saved Northwind evidence
      Given the configured gateway returns two Northwind source events from Elastic search
      When the attendee asks the saved question in the Elastic stage
      Then the answer cites both returned source events identified in the visible response trace

    Scenario: Renewal evidence preserves uncertainty about the usage decline
      Given Elastic returns the usage decline and open SCIM case without a confirmed cause or fix date
      When the attendee asks what puts the renewal at risk
      Then the connected response cites those records and identifies the cause and resolution date as unverified

    Scenario: The model never receives the direct Elastic setup credential
      Given the operator has configured an Elastic setup endpoint and key for fixture loading
      And the configured gateway returns the saved Northwind source events
      When the attendee asks the saved question in the Elastic stage
      Then the answer cites those returned events while model-facing configuration and messages contain neither the setup endpoint nor key

    @rejection
    Scenario: No matching account evidence exists
      Given Elastic search returns no Northwind records through the configured gateway
      When the attendee asks the saved question in the Elastic stage
      Then the answer reports missing evidence without invented source IDs

  @connected-workshop.ATT1.R3 @surface.gateway
  Rule: connected-workshop.ATT1.R3 — Access and authority are enforced outside the model
    Scenario: The analyst cannot discover offer creation
      Given Sam is authenticated and the gateway contains the offer creation tool
      When Sam requests tool discovery
      Then offer creation is absent from Sam's discovered tools while research tools remain available

    @rejection
    Scenario: The analyst cannot execute a known offer creation tool directly
      Given Sam is authenticated and knows the gateway's offer creation tool name
      When Sam attempts a direct offer creation call
      Then the gateway denies execution without a business write

    @rejection
    Scenario: An unknown identity cannot execute offer creation
      Given the caller's identity is not in the workshop roster
      When the caller attempts CreateDiscountedOffer through the gateway
      Then the gateway denies the unknown identity without a business write

    Scenario Outline: The requested percentage determines the authority decision
      Given Dana has a 15% discount ceiling and Northwind has stored list price 12000
      When Dana requests a <discount>% offer with the current list price through the gateway
      Then the offer creation decision is <decision>
      Examples:
        | discount | decision |
        | 15       | allowed  |
        | 15.01    | denied   |
        | 30       | denied   |

    @rejection
    Scenario: A changed price assertion cannot alter authoritative value
      Given Northwind has stored list price 12000 and Dana has a 15% discount ceiling
      When Dana submits a 15% offer with asserted list price 8400
      Then the request fails and the stored list price remains 12000 with no saved offer

  @connected-workshop.ATT1.R4 @surface.gateway
  Rule: connected-workshop.ATT1.R4 — An approved operation writes once with exact arguments
    Scenario: An approved retry survives duplicate delivery and restart
      Given Riley approved Dana's exact Northwind 30% offer at list price 12000 and the operation has already succeeded
      When the same operation is delivered again after the account service restarts
      Then the caller receives the original result and Northwind still has exactly one draft offer and follow-up-email draft

    @rejection
    Scenario Outline: A changed action cannot use the original approval
      Given Riley approved Dana's exact Northwind 30% offer at list price 12000
      When a retry changes the approved <field>
      Then the retry is denied without an additional offer
      Examples:
        | field            |
        | discount_percent |
        | list_price       |
        | rationale        |
        | customer_message |
        | requester        |
        | account_id       |
        | tool             |
        | operation_key    |

    @rejection
    Scenario: A changed stored value invalidates the original approval
      Given Riley approved Dana's exact Northwind 30% offer at list price 12000
      And Northwind's current stored list price is now 14000
      When Dana retries the originally approved action through the gateway
      Then the gateway denies the stale price assertion and no offer is saved

    @rejection
    Scenario: A consumed grant cannot authorize a fresh operation
      Given Riley's grant for Dana's exact Northwind action was consumed by its completed offer
      When Dana submits the same business arguments under a new operation key
      Then the gateway denies the new operation and Northwind still has exactly one draft offer

    @rejection
    Scenario: A grant expired at write time cannot authorize execution
      Given Riley's unused grant for Dana's exact Northwind action has expired before execution
      When Dana submits that action directly through the gateway
      Then the gateway denies the expired grant without a business write

    @rejection
    Scenario: A changed body cannot reuse an operation key
      Given Dana's Northwind operation has already succeeded under its saved operation key
      When an offer request reuses that key with a different discount percentage
      Then the account API reports a conflict and Northwind still has exactly one draft offer

  @connected-workshop.ATT1.R5 @surface.gateway
  Rule: connected-workshop.ATT1.R5 — Sensitive output cannot reach the model
    Scenario: The governed agent receives filtered evidence through its gateway connection
      Given the governed stage uses its configured gateway and Northwind contains the synthetic pasted API key, phone and injected instruction
      When the attendee asks the saved question through the agent API
      Then the model-facing messages and final brief cite returned source events and contain none of those markers

    Scenario Outline: Successful governed results are filtered
      Given a <source> result in <form> contains the synthetic pasted API key, phone and injected instruction
      When the result passes through the post-hook toward Mastra
      Then the model-facing result retains legitimate evidence and contains none of those markers
      Examples:
        | source                | form                    |
        | GetAccount            | a JSON object           |
        | CreateDiscountedOffer | a JSON object           |
        | GetOffer              | a JSON object           |
        | Elastic search        | a JSON object           |
        | Elastic search        | JSON in MCP text blocks |

    Scenario: The pasted support credential is filtered without hiding the renewal risk
      Given the raw Northwind account contains a fake pasted key in support.api_key and a synthetic personal phone
      When GetAccount passes through the gateway post-hook
      Then the model-facing result omits the key field, key string and phone while retaining the 12000 list price, October 31 renewal and unresolved SCIM issue

    @rejection
    Scenario: An unsupported sensitive result fails closed
      Given a sensitive tool returns an unsupported payload shape
      When the result passes through the post-hook
      Then the gateway receives a failed check without raw output

    @rejection
    Scenario: A filtering failure cannot return raw content
      Given filtering fails while processing a supported sensitive result
      When the result passes through the post-hook
      Then the gateway receives a failed check without raw output

  @connected-workshop.ATT1.R6 @surface.workshop-web @surface.gateway
  Rule: connected-workshop.ATT1.R6 — The original request survives its human wait
    Scenario: A denied action produces the persisted approval wait
      Given Dana has a 15% discount ceiling and Northwind has stored list price 12000
      When Dana asks the agent to prepare Northwind's 30% discount offer with approval if needed
      Then the run is suspended with a delivered approval linked to that exact persisted denial and no saved offer

    Scenario: Resume after the original caller exits and the web service restarts
      Given the agent suspended after requesting approval and the original HTTP request ended
      And Riley's authenticated approval is recorded for the exact action
      When the restarted web service resumes that stored run for its original requester
      Then the same run executes Dana's saved 30% action through the same gateway with one 8400 USD draft offer and a cited final brief

    @rejection
    Scenario Outline: An unresolved permission cannot resume a write
      Given the stored request's approval is <status>
      When the requester attempts to resume the original run
      Then the response reports <status> and no business write occurs
      Examples:
        | status  |
        | pending |
        | denied  |
        | expired |

  @connected-workshop.ATT1.R7 @surface.workshop-web @surface.gateway
  Rule: connected-workshop.ATT1.R7 — The saved offer is a local draft that the agent checks
    Scenario: The connected agent reads the approved offer back
      Given Riley approved Dana's saved 30% Northwind action at list price 12000
      And the connected test model follows the workshop GetOffer instruction
      When Dana's stored run resumes through the agent API
      Then the trace contains GetOffer for ACC-2291 after the saved action and the final cited response reports the returned 30%, 12000 list price and 8400 net price as a local draft

    Scenario: The saved follow-up preserves the reviewed customer message
      Given Riley approved an exact customer message acknowledging declining usage and the open support issue
      When Dana's approved renewal action executes
      Then follow_up_email preserves that message verbatim with the account-owned recipient, canonical annual terms and a local-draft label

    @rejection
    Scenario: A blank customer message cannot create a generic replacement draft
      Given Dana submits valid commercial terms and a blank customer_message
      When the account API validates the offer request
      Then it rejects the request without an offer, email draft or operation receipt

    @rejection
    Scenario: A saved offer without a read-back cannot count as a completed run
      Given Dana's approved 30% offer has been saved and the model produces a final answer without calling GetOffer
      When the host validates the run's completion
      Then it reports the saved offer and failed read-back instead of completion without creating another offer

    @rejection
    Scenario: A pre-write read cannot substitute for checking the saved offer
      Given the model read an earlier offer before saving Dana's approved 30% offer and made no read afterward
      When the host validates the run's completion
      Then it reports the saved offer and missing post-write read-back instead of completion

    @rejection
    Scenario: A failed GetOffer call cannot count as verification
      Given Dana's approved offer has been saved and the subsequent GetOffer call failed
      When the host validates the run's completion
      Then it reports the saved offer and failed read-back instead of completion

    @rejection
    Scenario Outline: Read-back must match the saved offer
      Given Dana's saved offer has a successful subsequent GetOffer result with a different <field>
      When the host validates the run's completion
      Then it reports the saved offer and mismatched read-back instead of completion
      Examples:
        | field            |
        | offer_id         |
        | account_id       |
        | discount_percent |
        | list_price       |
        | net_price        |
        | status           |
        | follow_up_email.to |
        | follow_up_email.subject |
        | follow_up_email.body |

    Scenario: Offer creation produces only local customer-facing drafts
      Given Dana has an approved exact Northwind 30% action at list price 12000
      When that action executes through the gateway
      Then the account stores one offer with draft status and a follow-up-email draft without invoking a customer email, signature or account-provisioning provider

    @rejection
    Scenario: Reading an account without an offer cannot invent saved terms
      Given Northwind exists and has no saved offer
      When the caller invokes GetOffer for ACC-2291
      Then the account API returns an offer-not-found response without draft terms

  @connected-workshop.ATT1.R8 @surface.operator-cli @surface.gateway
  Rule: connected-workshop.ATT1.R8 — Attendees can author and verify a bounded output rule
    Scenario: Initialize an editable rule without changing hosted policy
      Given the attendee has a new local output path for the hook lab
      When the attendee runs hook-lab init with that output path
      Then the file contains rule renewal-contact-redaction scoped to Sales.GetAccount with an empty fields list and no hosted policy change

    Scenario: The starter makes the missing redaction observable
      Given the attendee generated the Sales.GetAccount rule renewal-contact-redaction with an empty fields list
      When the attendee runs hook-lab test against that file
      Then the local-fixture check fails because the internal support owner email remains

    Scenario: The attendee's rule removes one internal field while preserving renewal context
      Given the rule removes support.internal_owner_email from Sales.GetAccount
      When the attendee runs hook-lab test against that file
      Then the local-fixture report passes with the email absent and account, price, renewal and unresolved issue preserved

    @rejection
    Scenario: An incorrect redaction path cannot earn a local pass
      Given the attendee's rule targets a path absent from the renewal fixture
      When the attendee runs hook-lab test against that file
      Then the local-fixture report fails because the internal owner email remains

    Scenario: Applying the tested rule preserves existing controls
      Given the valid rule removes the internal owner and the operator has a current authenticated policy
      When the attendee runs hook-lab apply against that file
      Then the policy includes the rule while retaining the existing access, discount and privacy controls

    @rejection
    Scenario: A failed local rule cannot be applied
      Given the rule fails to remove the internal owner from the renewal fixture
      When the attendee runs hook-lab apply against that file
      Then the command rejects the rule without changing the existing policy

    Scenario: Gateway verification proves the applied filter as Dana
      Given Dana has Sales consent and the applied rule removes the support owner from GetAccount
      When the attendee runs hook-lab verify with the observed GetAccount name
      Then the gateway-read report confirms the owner email is absent and renewal context remains without a model, business write or Slack call

    @rejection
    Scenario: Local fixture success cannot substitute for the gateway result
      Given the local rule test passed but the gateway GetAccount response still contains the internal owner email
      When the attendee runs hook-lab verify with the observed GetAccount name
      Then the gateway-read report fails without claiming remote enforcement

  @connected-workshop.APR1.R1 @surface.slack
  Rule: connected-workshop.APR1.R1 — Slack represents one server-derived approval request
    Scenario: Deliver the denied request to the minimum-sufficient approver
      Given Dana owns a persisted denial for Northwind's 30% offer at list price 12000
      And Riley has a 40% discount ceiling and Morgan has a 75% ceiling
      And Dana's delegated Slack authorization identifies the attendee's real Slack account
      When the web host requests review for the saved action and delivers its notification
      Then the self-DM names Riley as the assigned approver instead of Morgan and presents the exact 30% terms and customer message with an opaque review link

    Scenario Outline: Assignment uses the narrowest sufficient discount ceiling
      Given Dana owns a persisted denial for a <discount>% Northwind offer
      And Riley has a 40% discount ceiling and Morgan has a 75% ceiling
      When the host requests review for that saved denial
      Then the saved request assigns <approver> as its approver
      Examples:
        | discount | approver |
        | 40       | Riley    |
        | 40.01    | Morgan   |

    Scenario: One attendee receives the approval request in their own Slack account
      Given one attendee plays seeded Dana and Riley and only Dana has delegated Slack authorization
      And Slack identifies the attendee as the owner of Dana's delegated authorization
      When the web host delivers the persisted Northwind approval request
      Then the notification is delivered to that Slack user's self-DM with Riley still assigned as the approver

    @rejection
    Scenario: An unresolved Slack identity cannot become a guessed recipient
      Given Riley is assigned the request and Slack does not return a valid user and team for Dana's authorization
      When Dana requests its Slack notification through the app
      Then the app reports the identity failure without claiming delivery or sending to a guessed recipient

    @rejection
    Scenario: Failed requester authorization remains visible
      Given Dana's delegated Slack authorization was rejected
      When Dana requests the Northwind approval notification
      Then the requester sees an authorization failure and the notification is not reported as delivered

    Scenario: Pending Slack consent preserves the same approval wait
      Given Dana's exact Northwind denial has a saved approval request and Slack consent is pending
      When Dana completes consent and retries notification through the app
      Then the app delivers the original request in Dana's authorized self-DM without changing its approver, saved action or run

    @rejection
    Scenario Outline: An unavailable denial cannot become the requester's approval
      Given the requested denial <condition>
      When Dana requests approval through the app for the run containing that denial
      Then the service rejects the request without sending a Slack message
      Examples:
        | condition                    |
        | belongs to another requester |
        | does not exist               |

    @rejection
    Scenario: Initial Slack delivery failure is visible
      Given Dana owns a persisted Northwind denial and Slack rejects new notifications
      When Dana requests approval for that denial
      Then the requester sees an explicit delivery failure for the saved request ID and no delivered status

    Scenario: Failed Slack delivery can be retried without another approval request
      Given Dana's approval request exists and Slack rejects its notification
      When the requester retries delivery after Slack becomes available
      Then the app reports successful delivery for the original request ID with no duplicate approval request

    @rejection
    Scenario: An uncertain Slack result cannot trigger an automatic duplicate message
      Given Slack may have accepted the saved request's notification but its delivery acknowledgement is unresolved
      When Dana retries the notification through the app
      Then the app reports the unresolved delivery state without posting another message

  @connected-workshop.APR1.R2 @surface.approval-web
  Rule: connected-workshop.APR1.R2 — The authenticated assigned identity controls the decision
    Scenario: One attendee switches into the seeded approver's authenticated session
      Given one attendee plays seeded Dana and Riley with no second person or additional inbox
      And the approval page currently has that attendee's Dana session
      When the attendee uses the persona switcher to complete OAuth sign-in as Riley
      Then the completed sign-in flow establishes Riley's verified OAuth subject on the approval page, distinct from the prior Dana session

    Scenario: The designated approver decides through the authenticated app
      Given the same attendee who requested as Dana now has Riley's valid web OAuth session
      And Riley is assigned the pending Northwind request
      When the attendee submits approval as Riley with valid CSRF protection
      Then hooks independently validates Riley's token and one grant binds Dana's exact action without an approval MCP call

    Scenario: Repeating the same approval returns one existing grant
      Given Riley has already approved Dana's exact Northwind request
      When authenticated Riley submits the identical approval again
      Then the response reports the existing decision and exactly one grant binds Dana's action

    @rejection
    Scenario: A conflicting second decision cannot replace the committed approval
      Given Riley has already approved Dana's exact Northwind request
      When authenticated Riley submits a denial for that request
      Then the response reports a decision conflict and the original approval still has exactly one grant for Dana's action

    @rejection
    Scenario: The human identity cannot be verified at the decision service
      Given Riley has a valid web OAuth session and the pending request is assigned to Riley
      And hooks cannot validate the human's token with the IdP
      When Riley submits approval with valid CSRF protection
      Then the approver sees an explicit verification failure and no grant binds Dana's action

    @rejection
    Scenario: Receiving the own-Slack link does not let Dana self-approve
      Given the attendee received Riley's request link in their own real Slack account
      And the approval page still has that attendee's authenticated Dana session
      When the attendee submits approval through the received link
      Then the requester-role self-vote is denied without a grant

    @rejection
    Scenario: A Riley persona label cannot replace OAuth authentication
      Given the attendee has an authenticated Dana session and Riley is assigned the request
      When the attendee submits approval with Riley named only in the body or query
      Then the decision remains attributed to Dana and is denied without a grant

    @rejection
    Scenario Outline: An untrusted decision is rejected
      Given the approval attempt has <condition>
      When the approval page submits a decision
      Then the decision fails with a <reason> rejection and no grant
      Examples:
        | condition                 | reason                  |
        | no authenticated identity | authentication required |
        | wrong assigned identity   | not assigned            |
        | forged CSRF state         | invalid CSRF            |
        | expired request           | expired                 |

  @connected-workshop.OPS1.R1 @surface.gateway @surface.operator-cli @surface.workshop-web
  Rule: connected-workshop.OPS1.R1 — Control state has a separate authenticated boundary
    Scenario: An ordinary viewer sees only filtered audit output
      Given Dana is authenticated and her completed run filtered the synthetic pasted API key, phone and injected instruction
      When Dana opens that run's audit record
      Then the record shows the correlated gateway decision and filtered evidence with none of those markers

    @rejection
    Scenario: A different requester cannot read the run record
      Given Sam is authenticated and is neither requester nor assigned approver of Dana's run
      When Sam requests that run record and its audit through the web API
      Then access is denied and none of Dana's run content is returned

    Scenario: A valid policy change changes subsequent authority decisions
      Given the operator is authenticated and Dana's 30% offer is denied at a 15% ceiling
      When the operator raises Dana's discount ceiling to 30% through the policy API
      Then the next equivalent gateway request is allowed under the new policy and audited

    @rejection
    Scenario: An invalid policy edit cannot partially raise authority
      Given the operator is authenticated and Dana's discount ceiling is 15%
      When the operator submits a policy edit raising Dana to 30% with a later invalid field
      Then the edit is rejected and the next equivalent 30% gateway request remains denied at a 15% ceiling

    @rejection
    Scenario Outline: Unauthorized control requests fail closed
      Given a request targets <surface> without its required credential
      When that request reaches the service
      Then the service rejects it without changing policy or exposing sensitive audit data
      Examples:
        | surface         |
        | Arcade hook     |
        | operator policy |
        | private audit   |

  @connected-workshop.OPS1.R2 @surface.operator-cli
  Rule: connected-workshop.OPS1.R2 — Workshop commands report real state and restore it safely
    Scenario Outline: Readiness checks the selected stage's prerequisites
      Given the <stage> stage has <configuration>
      When the operator runs readiness for that stage
      Then the command reports <verdict>
      Examples:
        | stage    | configuration                                   | verdict                                      |
        | supplied | a model credential and no Arcade configuration | configured with model execution unexercised   |
        | Elastic  | a model credential but no gateway               | not ready because the gateway is missing     |
        | governed | a gateway but no verified hooks                 | not ready because hooks are unverified       |

    Scenario: Seeding preserves the eight known fixture identifiers
      Given an empty Elastic index and the checked-in clean fixture
      When the operator runs the seed command twice
      Then the index contains exactly the eight fixture events with their original source IDs

    Scenario Outline: The selected fixture variant determines marker presence
      Given an empty Elastic index and the eight known fixture source IDs
      And governance has verified denial and filtering checks and is active
      When the operator seeds the <variant> fixture
      Then the index contains those eight events and the synthetic pasted API key, phone and injected instruction are <presence>
      Examples:
        | variant  | presence                       |
        | clean    | absent from every event        |
        | governed | present in one Northwind event |

    Scenario: Gateway setup uses observed remote tool names
      Given remote MCP discovery reports the selected search tool as Observed_Search
      When the operator configures the gateway from that observed selection
      Then the generated gateway configuration names Observed_Search without substituting a guessed name

    Scenario: Hook inventory bootstraps an unmapped native Elastic tool
      Given authenticated access discovery observed an unmapped native Elastic tool and no invocation argument keys
      When the operator runs hook-tools
      Then the inventory contains its actual toolkit and tool names with an empty argument list and contains no argument values or credentials

    Scenario: Governance verification proves a filtered read and the matching denied probe
      Given the separate verification identity has Sales consent and the fail-closed hooks are correctly registered
      When the operator verifies governance with the observed GetAccount and CreateDiscountedOffer names
      Then the report confirms a fresh filtered ACC-2291 read and the gateway's matching 30% authority denial without a model run, approval request, Slack call or saved offer

    @rejection
    Scenario: A missing pre-hook cannot turn the setup probe into a draft offer
      Given the gateway's pre-hook is missing and the verification identity has Sales consent
      When the operator verifies governance with the 30% probe and its deliberately empty rationale
      Then the account API rejects the empty rationale and verification fails without a saved offer or activation confirmation

    @rejection
    Scenario: Hook callbacks alone cannot activate attendee access
      Given hooks recorded filtering and denial callbacks without a completed gateway verification confirmation
      When the operator requests workshop activation
      Then activation is rejected and normal Sales roles remain staged

    @rejection
    Scenario: Discovery without a usable search tool cannot produce guessed setup
      Given remote MCP discovery reports no usable search tool
      When the operator runs gateway setup
      Then the command fails visibly and writes no gateway configuration

    Scenario: Reset restores a repeatable workshop without rotating OAuth clients
      Given exercise data includes an extra Elastic event, draft offer, grant, and suspended request
      When the operator resets the workshop to the clean fixture
      Then eight clean Elastic events remain and exercise state is cleared while both OAuth clients retain their credentials

    @rejection
    Scenario Outline: Missing live credentials cannot produce a ready verdict
      Given required Arcade and Elastic credentials are absent
      When the operator runs the live <command> command
      Then the command reports the missing boundary without a live pass
      Examples:
        | command   |
        | readiness |
        | capstone  |

    @rejection
    Scenario Outline: Credentials cannot substitute for observed boundary proof
      Given live credentials are present but the required <boundary> boundary is <state>
      When the operator runs the live capstone command
      Then its report marks that boundary <state> and the command exits unsuccessfully without a live pass
      Examples:
        | boundary | state       |
        | Slack    | unexercised |
        | Arcade   | failed      |

    @rejection
    Scenario: Shared read-only evidence produces a degraded capstone result
      Given the attendee uses the declared shared read-only Elastic fallback
      When the operator runs the capstone command
      Then its report is degraded and gives no pass credit for the unexercised evidence mutation

    @live
    Scenario: Complete the full cloud workflow
      Given verified attendee-owned Mastra, Elastic, Arcade, and one real Slack account
      And seeded Dana and Riley have distinct OAuth subjects and Dana authorized the attendee's own Slack account
      When the attendee completes the governed Northwind journey
      Then the live run manifest records each verified outcome with its correlated artifact
        | outcome                     | retained artifact                           |
        | Elastic citations           | Elastic response and citation trace         |
        | gateway denial              | Arcade execution and pre-hook decision      |
        | Slack delivery              | Slack channel and message receipt           |
        | authenticated Riley approval | verified subject and approval decision      |
        | resumed original run        | persisted run and continuation trace        |
        | exactly one draft offer     | operation receipt and account decision history |
        | checked draft terms         | GetOffer response and 30% / 12000 / 8400 trace |
        | filtered pasted credential  | sanitized model-facing account and support output |
        | reviewed customer follow-up | exact approved message and saved follow_up_email |
        | attendee-authored output rule | local-fixture and gateway-read hook-lab reports |
