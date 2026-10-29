# Play Console internal API (reverse engineered)

Not public and not covered by the Android Publisher API: these are the calls the Play Console web app makes.
They need the browser session (cookies + `X-Goog-AuthUser` + an API key), not the service account.

- Host: `https://playconsoleapps-pa.clients6.google.com/v1`
- Encoding: JSPB, i.e. protobuf as JSON with field numbers as keys (`{"1": 1}`)
- Method override: requests are `POST` with `$httpMethod=PATCH` and `updateMask.paths=<field>` in the query
- `{dev}` is the developer account id, `{app}` the Console app id (not the package name)

| Form | Call | Body | Notes |
| --- | --- | --- | --- |
| Privacy policy | `PATCH /developers/{dev}/apps/{app}/privacyPolicy?updateMask.paths=url` | not captured | |
| Ads | `PATCH /developers/{dev}/apps/{app}/adsDeclaration?updateMask.paths=developer_declaration` | `{"1":1}` | `1` = no ads |
| Ads (load) | `POST /developers/apps/appContent/adsDeclaration:startupData` | `{"2":{"1":{"1":"{dev}"},"2":{"1":"{app}"}}}` | |
| Login details (app access) | `PATCH /developers/{dev}/apps/{app}/testingCredentials?updateMask.paths=android_testing_consent,credentials,login_required` | `{"1":false,"3":true}` | `1` = login required (false), `3` = testing consent |
| Login details (load) | `POST /developers/apps/appContent/testingCredentials:startupData` | same shape as ads | |
| Advertising ID | `PATCH /developers/{dev}/apps/{app}/declarations/POLICY_DECLARATION_ID_ADVERTISING_ID` | `{"1":{"1":<appRef>,"2":6},"2":[{"1":66,"9":{"1":false}}],"5":false}` | generic policy declaration: `1.2` = declaration type, `2` = answers (`1` question id, `9.1` boolean answer) |
| Policy declaration (load) | `POST /developers/apps/appContent/policyDeclarations:startupData` | `{"13":{"1":<appRef>,"2":6}}` | |

`<appRef>` = `{"1":{"1":"{dev}"},"2":{"1":"{app}"}}`
| Government apps | `PATCH .../declarations/POLICY_DECLARATION_ID_GOVERNMENT_APPS` | type `10`, answers `[{"1":78,"9":{"1":false}}]` | |
| Financial features | `PATCH .../declarations/POLICY_DECLARATION_ID_FINANCE` | type `20`, answers `[{"1":87,"6":{"1":[130]}}]` | `6.1` = multiple choice ids; `130` = "no financial features". Console calls `...:validateQuestions` first with the same body |
| Health apps | `PATCH .../declarations/POLICY_DECLARATION_ID_HEALTH` | type `26`, answers `[{"1":185,"6":{"1":[330]}}]` | `330` = "no health features" |
| Target audience | `PATCH /developers/{dev}/apps/{app}/targetAudienceContent?updateMask.paths=age_screen_present,certified_ad_network,children_laws_compliance,family_category,family_opt_in,supported_audience,target_age_bands` | `{"1":[6],"11":true,"12":0}` | `1` = target age bands (`6` = 18+) |
| Content rating (IARC) 1/3 | `PATCH /developers/{dev}/apps/{app}/contentRating/{n}/filledIarcQuestionnaire?updateMask.paths=answers,email_address,language_code` | `{"1":{<appRef>,"3":{"1":"{n}"}},"2":"10.0","3":"<email>","4":{"1":[{"1":<questionId>,"2":[<answerId>]},...]},"5":1,"7":"pt-PT"}` | category "all other apps" answered all "No": `1109→2558, 1152→2618, 1188→2628, 1193→2630, 1037→2370, 1194→2632, 1195→2334, 1375→2940, 1196→2223, 1197→2634`. `{n}` comes from `POST .../contentRating:startFilledQuestionnaire` |
| Content rating 2/3 | `POST /developers/{dev}/apps/{app}/contentRating/{n}:calculate` | `{"1":{<appRef>,"3":{"1":"{n}"}}}` | |
| Content rating 3/3 | `POST /developers/{dev}/apps/{app}/contentRating/{n}:applyRating` | `{"1":{<appRef>,"3":{"1":"{n}"}},"2":"2"}` | result for Fake Traveler: ClassInd L, ESRB E, PEGI 3, IARC 3+ |
| Content rating (questions) | `GET /developers/apps/appContent/contentRating/iarcQuestionnaire/{locale}` | | question/answer ids and texts |
| Data safety ("collects nothing") | `PATCH .../declarations/POLICY_DECLARATION_ID_PSL` | type `3`, answers `[{"1":5,"9":{"1":false}}]` | when data IS collected, use the public `POST applications/{package}/dataSafety` with the CSV instead (`playctl datasafety`) |
| App category | `PATCH /developers/{dev}/apps/{app}/storesettings?updateMask.paths=app_category` | `{"1":<appRef>,"2":{...}}` | the body carries the whole category catalog with the selected id; capture it again before automating |

## Status

Mapped while setting up `com.diegohorvatti.fakeTraveler` on 2026-10-29. Every row above returned 200 from the Console.
These endpoints authenticate with the signed-in browser session, not with a service account, so `playctl` does
not call them. Use this table to drive the Console (browser automation) or to move each form to the public API
once Google exposes it. The public Android Publisher API already covers: store listing and images (`images`),
contact details (`details`), Data safety via CSV (`datasafety`), AAB upload and tracks (`upload`, `promote`).
