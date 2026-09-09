Feature: An attendee completes one governed lead workflow across Mastra, Elastic, and Arcade

  One attendee plays distinct seeded OAuth identities and receives notifications through
  an explicit mapping to their own real Slack account. The @live scenario is excluded
  from the local test lane and requires separately retained cloud evidence.

  @connected-workshop.ATT1.R1 @surface.workshop-web
  Rule: connected-workshop.ATT1.R1 — Each stage runs with its own prerequisites
    Scenario: Start the attendee's agent before connecting cloud tools
      Given the model is available and no Arcade or Elastic credentials are configured
      When the attendee submits the supplied Northwind question through the agent API
      Then the response identifies supplied facts and missing evidence without a tool call

    Scenario Outline: The selected stage controls tools offered to the same agent
      Given one configured gateway exposes Elastic search, Lead, and Approvals tools
      When the attendee opens the same agent in the <stage> stage
      Then the model is offered exactly the configured <tools> toolset
      Examples:
        | stage    | tools                        |
        | Elastic  | Elastic                      |
        | governed | Elastic, Lead, and Approvals  |

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
    Scenario: The analyst cannot discover routing
      Given Sam is authenticated and the gateway contains the routing tool
      When Sam requests tool discovery
      Then routing is absent from Sam's discovered tools while research tools remain available

    @rejection
    Scenario: The analyst cannot execute a known routing tool directly
      Given Sam is authenticated and knows the gateway's routing tool name
      When Sam attempts a direct routing call
      Then the gateway denies execution without a business write

    @rejection
    Scenario: An unknown identity cannot execute routing
      Given the caller's identity is not in the workshop roster
      When the caller attempts routing through the gateway
      Then the gateway denies the unknown identity without a business write

    Scenario Outline: Current stored value determines the authority decision
      Given Dana has authority of 50000 and the lead has stored ACV <acv>
      When Dana attempts to route that lead through the gateway
      Then the routing decision is <decision>
      Examples:
        | acv   | decision |
        | 49999 | allowed  |
        | 50000 | allowed  |
        | 95000 | denied   |

    @rejection
    Scenario: A lowball argument cannot alter authoritative value
      Given Northwind has stored ACV 95000 and Dana has authority 50000
      When Dana submits a route with asserted ACV 49000
      Then the request fails and the stored ACV remains 95000 with no new route

  @connected-workshop.ATT1.R4 @surface.gateway
  Rule: connected-workshop.ATT1.R4 — An approved operation writes once with exact arguments
    Scenario: An approved retry survives duplicate delivery and restart
      Given Riley approved Dana's exact Northwind route and the operation has already succeeded
      When the same operation is delivered again after the lead service restarts
      Then the caller receives the original result and Northwind still has exactly one new route

    @rejection
    Scenario Outline: A changed action cannot use the original approval
      Given Riley approved Dana's exact Northwind route
      When a retry changes the approved <field>
      Then the retry is denied without an additional route
      Examples:
        | field     |
        | owner     |
        | amount    |
        | rationale |
        | requester |
        | resource  |
        | tool      |

    @rejection
    Scenario: A changed stored value invalidates the original approval
      Given Riley approved Dana's exact Northwind route at stored ACV 95000
      And Northwind's current stored ACV is now 300000
      When Dana retries the originally approved action through the gateway
      Then the gateway denies the stale approved value and no route is written

    @rejection
    Scenario: A consumed grant cannot authorize a fresh operation
      Given Riley's grant for Dana's exact Northwind action was consumed by its completed route
      When Dana submits the same business arguments under a new operation key
      Then the gateway denies the new operation and Northwind still has exactly one route

    @rejection
    Scenario: A grant expired at write time cannot authorize execution
      Given Riley's unused grant for Dana's exact Northwind action has expired before execution
      When Dana submits that action directly through the gateway
      Then the gateway denies the expired grant without a business write

    @rejection
    Scenario: A changed body cannot reuse an operation key
      Given Dana's Northwind operation has already succeeded under its saved operation key
      When a route request reuses that key with a different owner
      Then the lead API reports a conflict and Northwind still has exactly one route

  @connected-workshop.ATT1.R5 @surface.gateway
  Rule: connected-workshop.ATT1.R5 — Sensitive output cannot reach the model
    Scenario: The governed agent receives filtered evidence through its gateway connection
      Given the governed stage uses its configured gateway and Northwind contains the synthetic phone and injected instruction
      When the attendee asks the saved question through the agent API
      Then the model-facing messages and final brief cite returned source events and contain neither marker

    Scenario Outline: Successful governed results are filtered
      Given a <source> result in <form> contains the synthetic phone and injected instruction
      When the result passes through the post-hook toward Mastra
      Then the model-facing result retains legitimate evidence and contains neither marker
      Examples:
        | source         | form                   |
        | Lead read      | a JSON object          |
        | Lead route     | a JSON object          |
        | classification | a JSON object          |
        | Elastic search | a JSON object          |
        | Elastic search | JSON in MCP text blocks |

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
      Given Dana has authority 50000 and Northwind has stored ACV 95000
      When Dana asks the agent to route Northwind with approval if needed
      Then the run is suspended with a delivered approval linked to that exact persisted denial and no route write

    Scenario: Resume after the original caller exits and the web service restarts
      Given the agent suspended after requesting approval and the original HTTP request ended
      And Riley's authenticated approval is recorded for the exact action
      When the restarted web service resumes that stored run for its original requester
      Then the same run completes through the same gateway with one route and a cited final brief

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

  @connected-workshop.APR1.R1 @surface.slack
  Rule: connected-workshop.APR1.R1 — Slack represents one server-derived approval request
    Scenario: Deliver the denied request to the minimum-sufficient approver
      Given Dana owns a persisted denial for the 95000 Northwind route
      And Riley has authority 250000 and Morgan has authority 5000000
      And their demo recipient mappings point to the attendee's own real Slack account
      When the approvals tool requests human approval using Dana's Slack authorization
      Then the Slack request names Riley as the assigned approver instead of Morgan and contains the original action and an opaque review link

    Scenario: One attendee receives the approval request in their own Slack account
      Given one attendee plays seeded Dana and Riley and only Dana has delegated Slack authorization
      And Riley's explicit demo recipient mapping points to the attendee's own real Slack account
      When Dana requests approval for the persisted Northwind denial
      Then the notification is delivered to that mapped account with Riley still assigned as the approver

    @rejection
    Scenario: A missing demo recipient mapping is visible
      Given Riley is assigned the request and has no demo Slack recipient mapping
      When Dana requests its Slack notification
      Then the tool reports the missing mapping without claiming delivery or sending to a guessed recipient

    @rejection
    Scenario: Failed requester authorization remains visible
      Given Dana's delegated Slack authorization was rejected
      When Dana requests the Northwind approval notification
      Then the requester sees an authorization failure and the notification is not reported as delivered

    @rejection
    Scenario Outline: An unavailable denial cannot become the requester's approval
      Given the requested denial <condition>
      When Dana requests approval using its denial ID
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
      Then the tool reports successful delivery for the original request ID with no duplicate approval request

  @connected-workshop.APR1.R2 @surface.approval-web @surface.gateway
  Rule: connected-workshop.APR1.R2 — The authenticated assigned identity controls the decision
    Scenario: One attendee switches into the seeded approver's authenticated session
      Given one attendee plays seeded Dana and Riley with no second person or additional inbox
      And the approval page currently has that attendee's Dana session
      When the attendee uses the persona switcher to complete OAuth sign-in as Riley
      Then the completed sign-in flow establishes Riley's verified OAuth subject on the approval page, distinct from the prior Dana session

    Scenario: The designated approver decides through Arcade
      Given the same attendee who requested as Dana now has Riley's valid web OAuth session
      And Riley is assigned the pending Northwind request
      When the attendee submits approval as Riley with valid CSRF protection
      Then Arcade executes the decision as Riley and one grant binds Dana's exact action

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
    Scenario: Arcade rejects execution of an otherwise valid decision
      Given Riley has a valid OAuth session and the pending request is assigned to Riley
      And Arcade rejects the decision execution before the tool runs
      When Riley submits approval with valid CSRF protection
      Then the approver sees an explicit execution failure and no grant binds Dana's action

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
      Given Dana is authenticated and her completed run filtered the synthetic phone and injected instruction
      When Dana opens that run's audit record
      Then the record shows the correlated gateway decision and filtered evidence with neither marker

    @rejection
    Scenario: A different requester cannot read the run record
      Given Sam is authenticated and is neither requester nor assigned approver of Dana's run
      When Sam requests that run record and its audit through the web API
      Then access is denied and none of Dana's run content is returned

    Scenario: A valid policy change changes subsequent authority decisions
      Given the operator is authenticated and Dana's 95000 route is denied at 50000
      When the operator raises Dana's authority to 100000 through the policy API
      Then the next equivalent gateway request is allowed under the new policy and audited

    @rejection
    Scenario: An invalid policy edit cannot partially raise authority
      Given the operator is authenticated and Dana's authority is 50000
      When the operator submits a policy edit raising Dana to 100000 with a later invalid field
      Then the edit is rejected and the next equivalent 95000 gateway request remains denied at 50000

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
        | supplied | a model credential and no Arcade configuration | ready for supplied input                     |
        | Elastic  | a model credential but no gateway               | not ready because the gateway is missing     |
        | governed | a gateway but no verified hooks                 | not ready because hooks are unverified       |

    Scenario: Seeding preserves the eight known fixture identifiers
      Given an empty Elastic index and the checked-in clean fixture
      When the operator runs the seed command twice
      Then the index contains exactly the eight fixture events with their original source IDs

    Scenario Outline: The selected fixture variant determines marker presence
      Given an empty Elastic index and the eight known fixture source IDs
      When the operator seeds the <variant> fixture
      Then the index contains those eight events and the synthetic phone and injected instruction are <presence>
      Examples:
        | variant  | presence                       |
        | clean    | absent from every event        |
        | governed | present in one Northwind event |

    Scenario: Gateway setup uses observed remote tool names
      Given remote MCP discovery reports the selected search tool as Observed_Search
      When the operator configures the gateway from that observed selection
      Then the generated gateway configuration names Observed_Search without substituting a guessed name

    @rejection
    Scenario: Discovery without a usable search tool cannot produce guessed setup
      Given remote MCP discovery reports no usable search tool
      When the operator runs gateway setup
      Then the command fails visibly and writes no gateway configuration

    Scenario: Reset restores a repeatable workshop without rotating OAuth clients
      Given exercise data includes an extra Elastic event, route, grant, and suspended request
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
      And seeded Dana and Riley have distinct OAuth subjects with an explicit own-Slack recipient mapping
      When the attendee completes the governed Northwind journey
      Then the live run manifest records each verified outcome with its correlated artifact
        | outcome                     | retained artifact                           |
        | Elastic citations           | Elastic response and citation trace         |
        | gateway denial              | Arcade execution and pre-hook decision      |
        | Slack delivery              | Slack channel and message receipt           |
        | authenticated Riley approval | verified subject and approval decision      |
        | resumed original run        | persisted run and continuation trace        |
        | exactly one route           | operation receipt and lead decision history |
