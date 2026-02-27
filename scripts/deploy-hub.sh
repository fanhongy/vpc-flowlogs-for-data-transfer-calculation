#!/usr/bin/env bash
#
# deploy-hub.sh - Deploy the Hub stack for multi-account VPC Flow Logs setup
#
# This script deploys the Hub stack which creates:
# - DynamoDB table for AZ mapping (shared with spoke accounts)
# - Kinesis stream to receive flow logs from spoke accounts
# - CloudWatch Logs destination for cross-account log delivery
# - Calculator Lambda triggered by Kinesis
#
# Usage: ./scripts/deploy-hub.sh [config-file]
#   config-file: Path to deployment config JSON (default: deploy-config.json)
#
# Prerequisites:
# - jq installed
# - AWS CLI configured with appropriate credentials
# - CDK CLI installed (npx cdk)
# - Node.js dependencies installed (npm install)

set -euo pipefail

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default configuration file
CONFIG_FILE="${1:-${PROJECT_ROOT}/deploy-config.json}"

# Output file for hub stack outputs
HUB_OUTPUTS_FILE="${PROJECT_ROOT}/.hub-outputs.json"

usage() {
    echo "Usage: $(basename "$0") [config-file]"
    echo ""
    echo "Deploy the Hub stack for multi-account VPC Flow Logs setup."
    echo ""
    echo "Arguments:"
    echo "  config-file  Path to deployment config JSON (default: deploy-config.json)"
    echo ""
    echo "Example:"
    echo "  $(basename "$0")"
    echo "  $(basename "$0") my-config.json"
    exit 1
}

# Check for help flag
if [[ "${1:-}" == "-h" ]] || [[ "${1:-}" == "--help" ]]; then
    usage
fi

# Validate config file exists
if [[ ! -f "${CONFIG_FILE}" ]]; then
    echo "Error: Configuration file not found: ${CONFIG_FILE}" >&2
    echo "Create deploy-config.json from deploy-config.example.json" >&2
    exit 1
fi

# Check for jq
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed" >&2
    exit 1
fi

echo "=========================================="
echo "Deploying Hub Stack"
echo "=========================================="
echo "Config file: ${CONFIG_FILE}"

# Read hub configuration
HUB_ACCOUNT_ID=$(jq -r '.hubAccount.id' "${CONFIG_FILE}")
HUB_REGION=$(jq -r '.hubAccount.region' "${CONFIG_FILE}")
HUB_PROFILE=$(jq -r '.hubAccount.profile' "${CONFIG_FILE}")
LAMBDA_CODE_BUCKET=$(jq -r '.hubAccount.lambdaCodeBucket' "${CONFIG_FILE}")
STACK_PREFIX=$(jq -r '.stackPrefix // "DTAZ"' "${CONFIG_FILE}")

# Get spoke account IDs as comma-separated list
SPOKE_ACCOUNT_IDS=$(jq -r '.spokeAccounts[].id' "${CONFIG_FILE}" | tr '\n' ',' | sed 's/,$//')

echo "Hub Account ID: ${HUB_ACCOUNT_ID}"
echo "Hub Region: ${HUB_REGION}"
echo "Hub Profile: ${HUB_PROFILE}"
echo "Lambda Code Bucket: ${LAMBDA_CODE_BUCKET}"
echo "Stack Prefix: ${STACK_PREFIX}"
echo "Spoke Account IDs: ${SPOKE_ACCOUNT_IDS}"
echo ""

# Set AWS profile
export AWS_PROFILE="${HUB_PROFILE}"
export AWS_REGION="${HUB_REGION}"

echo "Using AWS Profile: ${AWS_PROFILE}"
echo "Using AWS Region: ${AWS_REGION}"
echo ""

# Change to project root
cd "${PROJECT_ROOT}"

# Deploy Hub stack
STACK_NAME="${STACK_PREFIX}-HubStack"
echo "Deploying stack: ${STACK_NAME}"
echo ""

npx cdk deploy "${STACK_NAME}" \
    --require-approval never \
    -c lambdaCodeBucket="${LAMBDA_CODE_BUCKET}" \
    -c spokeAccountIds="${SPOKE_ACCOUNT_IDS}"

echo ""
echo "Hub stack deployment complete!"
echo ""

# Capture stack outputs
echo "Capturing stack outputs..."

# Get the CloudFormation stack outputs
DESTINATION_ARN=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='CWDestinationArn'].OutputValue" \
    --output text)

DDB_ROLE_ARN=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='DDBRoleArn'].OutputValue" \
    --output text)

# Write outputs to file for spoke deployment
cat > "${HUB_OUTPUTS_FILE}" << EOF
{
  "stackName": "${STACK_NAME}",
  "destinationArn": "${DESTINATION_ARN}",
  "ddbRoleArn": "${DDB_ROLE_ARN}",
  "hubAccountId": "${HUB_ACCOUNT_ID}",
  "hubRegion": "${HUB_REGION}"
}
EOF

echo "Stack outputs saved to: ${HUB_OUTPUTS_FILE}"
echo ""
echo "Outputs:"
echo "  Destination ARN: ${DESTINATION_ARN}"
echo "  DDB Role ARN: ${DDB_ROLE_ARN}"
echo ""
echo "=========================================="
echo "Hub Stack Deployment Complete"
echo "=========================================="
