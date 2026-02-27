#!/usr/bin/env bash
#
# deploy-spoke.sh - Deploy a Spoke stack for multi-account VPC Flow Logs setup
#
# This script deploys the Spoke stack which creates:
# - VPC Flow Logs with subscription to hub destination
# - CloudTrail with UpdateDDB Lambda
# - LoadDDB custom resource
#
# Usage: ./scripts/deploy-spoke.sh <spoke-index> [config-file]
#   spoke-index: Zero-based index of spoke account in config (0, 1, 2, ...)
#   config-file: Path to deployment config JSON (default: deploy-config.json)
#
# Prerequisites:
# - Hub stack must be deployed first (run deploy-hub.sh)
# - jq installed
# - AWS CLI configured with appropriate credentials
# - CDK CLI installed (npx cdk)
# - Node.js dependencies installed (npm install)

set -euo pipefail

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default configuration file
CONFIG_FILE="${2:-${PROJECT_ROOT}/deploy-config.json}"

# Hub outputs file
HUB_OUTPUTS_FILE="${PROJECT_ROOT}/.hub-outputs.json"

usage() {
    echo "Usage: $(basename "$0") <spoke-index> [config-file]"
    echo ""
    echo "Deploy a Spoke stack for multi-account VPC Flow Logs setup."
    echo ""
    echo "Arguments:"
    echo "  spoke-index  Zero-based index of spoke account in config (0, 1, 2, ...)"
    echo "  config-file  Path to deployment config JSON (default: deploy-config.json)"
    echo ""
    echo "Example:"
    echo "  $(basename "$0") 0                     # Deploy first spoke account"
    echo "  $(basename "$0") 1 my-config.json     # Deploy second spoke with custom config"
    exit 1
}

# Check for help flag
if [[ "${1:-}" == "-h" ]] || [[ "${1:-}" == "--help" ]]; then
    usage
fi

# Validate spoke index argument
if [[ -z "${1:-}" ]]; then
    echo "Error: spoke-index is required" >&2
    usage
fi

SPOKE_INDEX="${1}"

# Validate spoke index is a number
if ! [[ "${SPOKE_INDEX}" =~ ^[0-9]+$ ]]; then
    echo "Error: spoke-index must be a non-negative integer" >&2
    usage
fi

# Validate config file exists
if [[ ! -f "${CONFIG_FILE}" ]]; then
    echo "Error: Configuration file not found: ${CONFIG_FILE}" >&2
    exit 1
fi

# Validate hub outputs file exists
if [[ ! -f "${HUB_OUTPUTS_FILE}" ]]; then
    echo "Error: Hub outputs file not found: ${HUB_OUTPUTS_FILE}" >&2
    echo "Please deploy the hub stack first using deploy-hub.sh" >&2
    exit 1
fi

# Check for jq
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed" >&2
    exit 1
fi

# Validate spoke index is within range
SPOKE_COUNT=$(jq '.spokeAccounts | length' "${CONFIG_FILE}")
if [[ "${SPOKE_INDEX}" -ge "${SPOKE_COUNT}" ]]; then
    echo "Error: spoke-index ${SPOKE_INDEX} is out of range (0-$((SPOKE_COUNT - 1)))" >&2
    exit 1
fi

echo "=========================================="
echo "Deploying Spoke Stack (Index: ${SPOKE_INDEX})"
echo "=========================================="
echo "Config file: ${CONFIG_FILE}"

# Read spoke configuration
SPOKE_ACCOUNT_ID=$(jq -r ".spokeAccounts[${SPOKE_INDEX}].id" "${CONFIG_FILE}")
SPOKE_REGION=$(jq -r ".spokeAccounts[${SPOKE_INDEX}].region" "${CONFIG_FILE}")
SPOKE_PROFILE=$(jq -r ".spokeAccounts[${SPOKE_INDEX}].profile" "${CONFIG_FILE}")
LAMBDA_CODE_BUCKET=$(jq -r ".spokeAccounts[${SPOKE_INDEX}].lambdaCodeBucket" "${CONFIG_FILE}")
VPC_IDS=$(jq -r ".spokeAccounts[${SPOKE_INDEX}].vpcIds | join(\",\")" "${CONFIG_FILE}")
STACK_PREFIX=$(jq -r '.stackPrefix // "DTAZ"' "${CONFIG_FILE}")

# Read hub outputs
HUB_ACCOUNT_ID=$(jq -r '.hubAccountId' "${HUB_OUTPUTS_FILE}")
DESTINATION_ARN=$(jq -r '.destinationArn' "${HUB_OUTPUTS_FILE}")
DDB_ROLE_ARN=$(jq -r '.ddbRoleArn' "${HUB_OUTPUTS_FILE}")

echo "Spoke Account ID: ${SPOKE_ACCOUNT_ID}"
echo "Spoke Region: ${SPOKE_REGION}"
echo "Spoke Profile: ${SPOKE_PROFILE}"
echo "Lambda Code Bucket: ${LAMBDA_CODE_BUCKET}"
echo "VPC IDs: ${VPC_IDS}"
echo "Stack Prefix: ${STACK_PREFIX}"
echo "Hub Account ID: ${HUB_ACCOUNT_ID}"
echo "Destination ARN: ${DESTINATION_ARN}"
echo "DDB Role ARN: ${DDB_ROLE_ARN}"
echo ""

# Set AWS profile
export AWS_PROFILE="${SPOKE_PROFILE}"
export AWS_REGION="${SPOKE_REGION}"

echo "Using AWS Profile: ${AWS_PROFILE}"
echo "Using AWS Region: ${AWS_REGION}"
echo ""

# Change to project root
cd "${PROJECT_ROOT}"

# Step 1: Deploy Pre-Roles stack
PRE_ROLES_STACK_NAME="${STACK_PREFIX}-PreRolesStack-${SPOKE_ACCOUNT_ID}"
echo "Step 1: Deploying Pre-Roles stack: ${PRE_ROLES_STACK_NAME}"
echo ""

npx cdk deploy "${PRE_ROLES_STACK_NAME}" \
    --require-approval never \
    -c centralAccountId="${HUB_ACCOUNT_ID}"

echo ""
echo "Pre-Roles stack deployment complete!"
echo ""

# Step 2: Deploy Spoke stack
SPOKE_STACK_NAME="${STACK_PREFIX}-SpokeStack-${SPOKE_ACCOUNT_ID}"
echo "Step 2: Deploying Spoke stack: ${SPOKE_STACK_NAME}"
echo ""

npx cdk deploy "${SPOKE_STACK_NAME}" \
    --require-approval never \
    -c vpcIds="${VPC_IDS}" \
    -c centralAccountRoleArn="${DDB_ROLE_ARN}" \
    -c destinationArn="${DESTINATION_ARN}" \
    -c lambdaCodeBucket="${LAMBDA_CODE_BUCKET}"

echo ""
echo "=========================================="
echo "Spoke Stack Deployment Complete"
echo "=========================================="
echo "Account: ${SPOKE_ACCOUNT_ID}"
echo "Region: ${SPOKE_REGION}"
echo "VPCs monitored: ${VPC_IDS}"
echo "=========================================="
