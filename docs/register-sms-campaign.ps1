# Registers a SECOND A2P 10DLC Campaign (link-enabled) alongside the existing
# approved one, per the 2026-10-19 decision to add embedded links without
# touching the already-approved, currently-working campaign.
#
# Twilio's own model: one Campaign per Messaging Service, and an approved
# Campaign can't be edited in place. So this script:
#   1. Creates a NEW Messaging Service (the existing one keeps its existing
#      no-link Campaign, untouched).
#   2. Registers a NEW Campaign against it, under the SAME existing Brand,
#      with hasEmbeddedLinks=true and the five reworded, link-including
#      sample messages.
#
# This creates billed, real resources on your live Twilio account
# (~$15 one-time vetting fee + ~$1.50/month) and starts a fresh review
# cycle. REVIEW THIS WHOLE SCRIPT before running it.
#
# After this succeeds, you still need to (manually, in the Twilio Console):
#   - Messaging Service -> Integration -> Advanced Opt-Out: turn this on for
#     the NEW Messaging Service, same as you did for the original one. It is
#     a per-Service setting and does not carry over automatically.
#   - Once approved, give me the new Messaging Service SID so it can be
#     wired into the app's env vars (MESSAGING_SERVICE_SID) for real sending.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File docs\register-sms-campaign.ps1

$ErrorActionPreference = "Stop"

# --- Load credentials ---
# NOTE: .env.local's TWILIO_AUTH_TOKEN was confirmed invalid (401) against
# Twilio's own API on 2026-10-19 - it does not match the Account SID there.
# docs/Twilio info.txt's Auth Token was confirmed valid (200), so that's
# used here. .env.local and Vercel need a separate fix - flagged, not done
# automatically, since it affects the live deployed app's own Twilio calls.
$envFile = Join-Path $PSScriptRoot "..\.env.local"
$envLines = Get-Content $envFile | Where-Object { $_ -match "^TWILIO_ACCOUNT_SID=" }
foreach ($line in $envLines) {
    $parts = $line -split "=", 2
    $value = $parts[1].Trim().Trim('"').Trim("'")
    Set-Variable -Name $parts[0] -Value $value
}

$refFile = Join-Path $PSScriptRoot "Twilio info.txt"
$refContent = Get-Content $refFile -Raw
$TWILIO_AUTH_TOKEN = [regex]::Match($refContent, 'Auth Token:\s*(\S+)').Groups[1].Value

if (-not $TWILIO_ACCOUNT_SID -or -not $TWILIO_AUTH_TOKEN) {
    throw "Could not load TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN"
}

$existingBrandSid = "BN41234807c52606ef4f1368a48ead792d"
$sampleLinkForField = "https://www.wouldyouplease.com/r/cfe80f4d6f159d7b18da3546c77e5313956a601dfec1ac0a6ce0abc6706feab4"

$description = "Would You Please, Inc. operates wouldyouplease.com, a SaaS task-and-request tracking platform used by businesses, professional organizations, and individuals to assign, track, and follow up on tasks and requests with their own contacts, clients, employees, or vendors. As part of delivering this service, the platform's automated notification system sends transactional SMS messages - action-request notifications, task status updates, and limited follow-up reminders - to a user's designated contacts, after each contact has given verifiable opt-in consent through a secure web form. These are system-generated service messages tied to the platform's core task-tracking function, not personal messages composed and sent by an individual."

# Best-candidate wording pulled from docs/Twilio info.txt (the fuller of the
# several drafts in that file). CONFIRM this matches what was actually
# approved for the existing campaign before running - edit if not.
$messageFlow = "If a registered user of the Would You Please app indicates that they want to send text messages to a contact, the app sends an email to that contact with a secure link/button prompting the recipient to opt-in to SMS instead of email. Clicking the link routes the recipient to a dedicated web form where they must manually approve the phone number entered by the registered user or modify it if desired and check an un-pre-ticked checkbox explicitly consenting to receive task notifications, updates, and reminders from the registered Would You Please user. No text messages are ever sent prior to this verifiable web opt-in. Since production links use secure tokens via email, a functional demo replica of the form is hosted at wouldyouplease.com/textmessaging/demo. Workflow: 1. Recipient opens link to the web form. 2. Reviews sender info and enters/verifies mobile number. 3. Checks an un-pre-ticked box to grant consent. 4. Clicks 'Activate Text Messaging'."

$sample1 = "Would You Please: You have a new task Request via [Jane Smith]'s account, due [MM/DD/YYYY]. wouldyouplease.com/r/[token]. Reply STOP to opt out, HELP for help."
$sample2 = "Would You Please: Reminder - a task Request via [Jane Smith]'s account is due tomorrow, [MM/DD/YYYY]. wouldyouplease.com/r/[token]. Reply STOP to opt out, HELP for help."
$sample3 = "Would You Please: A task Request via [Jane Smith]'s account, due [MM/DD/YYYY], is now overdue. wouldyouplease.com/r/[token]. Reply STOP to opt out, HELP for help."
$sample4 = "Would You Please: A task Request via [Jane Smith]'s account was updated (Due Date changed). wouldyouplease.com/r/[token]. Reply STOP to opt out, HELP for help."
$sample5 = "Would You Please: Please confirm receipt of a task Request via [Jane Smith]'s account. wouldyouplease.com/r/[token]. Reply STOP to opt out, HELP for help."

$privacyPolicyUrl = "https://www.wouldyouplease.com/textmessaging/demo"
$termsUrl = "https://www.wouldyouplease.com/textmessaging/demo"

Write-Host "Step 1: Creating new Messaging Service..." -ForegroundColor Cyan
$msResponse = & curl.exe -s -X POST "https://messaging.twilio.com/v1/Services" `
    --data-urlencode "FriendlyName=WYP Request Texting (link-enabled)" `
    -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}"

Write-Host $msResponse
$msJson = $msResponse | ConvertFrom-Json
if (-not $msJson.sid) {
    throw "Messaging Service creation failed - see response above. Stopping before any Campaign submission."
}
$newMessagingServiceSid = $msJson.sid
Write-Host "New Messaging Service SID: $newMessagingServiceSid" -ForegroundColor Green

Write-Host ""
Write-Host "Step 2: Registering new Campaign (this submits for review and incurs fees)..." -ForegroundColor Cyan
Write-Host "Press Ctrl+C now to abort before this call is made." -ForegroundColor Yellow
Start-Sleep -Seconds 5

$campaignResponse = & curl.exe -s -X POST "https://messaging.twilio.com/v1/Services/$newMessagingServiceSid/Compliance/Usa2p" `
    --data-urlencode "BrandRegistrationSid=$existingBrandSid" `
    --data-urlencode "Description=$description" `
    --data-urlencode "MessageFlow=$messageFlow" `
    --data-urlencode "MessageSamples=$sample1" `
    --data-urlencode "MessageSamples=$sample2" `
    --data-urlencode "MessageSamples=$sample3" `
    --data-urlencode "MessageSamples=$sample4" `
    --data-urlencode "MessageSamples=$sample5" `
    --data-urlencode "UsAppToPersonUsecase=LOW_VOLUME" `
    --data-urlencode "HasEmbeddedLinks=true" `
    --data-urlencode "HasEmbeddedPhone=false" `
    --data-urlencode "AgeGated=false" `
    --data-urlencode "DirectLending=false" `
    --data-urlencode "PrivacyPolicyUrl=$privacyPolicyUrl" `
    --data-urlencode "TermsAndConditionsUrl=$termsUrl" `
    -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}"

Write-Host $campaignResponse
Write-Host ""
Write-Host "Done. Check the 'campaign_status' field above - it should show as pending review." -ForegroundColor Green
Write-Host "Remember: go turn on Advanced Opt-Out for this new Messaging Service in the Console." -ForegroundColor Yellow
