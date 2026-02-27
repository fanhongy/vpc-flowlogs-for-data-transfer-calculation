#!/usr/bin/env bash
#
# teardown.sh - Clean removal of VPC Flow Logs stacks
#
# This script removes all deployed stacks in the correct order:
# - Multi-account: Spokes first (parallel), then Hub
# - Single-account: Just the SingleAccountStack
#
# Usage: ./scripts/teardown.sh [config-file] [options]
#
# Options:
#   config-file       Path to deployment config JSON (default: deploy-config.json)
#   --single-account  Delete SingleAccountStack instead of multi-account stacks
#   --prefix <prefix> Stack name prefix (default: DTAZ, or from config)
#   --profile <name>  AWS profile for single-account mode
#   --region <region> AWS region for single-account mode
#   --force           Skip confirmation prompt
#
# Prerequisites:
# - AWS CLI configured with appropriate credentials
# - CDK CLI installed (npx cdk)

set -euo pipefail

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default values
CONFIG_FILE="${PROJECT_ROOT}/deploy-config.json"
SINGLE_ACCOUNT_MODE=false
STACK_PREFIX=""
AWS_PROFILE_NAME=""
AWS_REGION_NAME=""
FORCE_MODE=false

usage() {
    echo "Usage: $(basename "$0") [config-file] [options]"
    echo ""
    echo "Clean removal of VPC Flow Logs stacks."
    echo ""
    echo "Options:"
    echo "  config-file        Path to deployment config JSON (default: deploy-config.json)"
    echo "  --single-account   Delete SingleAccountStack instead of multi-account stacks"
    echo "  --prefix <prefix>  Stack name prefix (default: DTAZ)"
    echo "  --profile <name>   AWS profile for single-account mode"
    echo "  --region <region>  AWS region for single-account mode"
    echo "  --force            Skip confirmation prompt"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  $(basename "$0")                              # Teardown multi-account using default config"
    echo "  $(basename "$0") my-config.json               # Use custom config"
    echo "  $(basename "$0") --single-account             # Teardown single-account stack"
    echo "  $(basename "$0") --single-account --force     # Skip confirmation"
    exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "${1}" in
        -h|--help)
            usage
            ;;
        --single-account)
            SINGLE_ACCOUNT_MODE=true
            shift
            ;;
        --prefix)
            if [[ -z "${2:-}" ]]; then
                echo "Error: --prefix requires a value" >&2
                exit 1
            fi
            STACK_PREFIX="${2}"
            shift 2
            ;;
        --profile)
            if [[ -z "${2:-}" ]]; then
                echo "Error: --profile requires a value" >&2
                exit 1
            fi
            AWS_PROFILE_NAME="${2}"
            shift 2
            ;;
        --region)
            if [[ -z "${2:-}" ]]; then
                echo "Error: --region requires a value" >&2
                exit 1
            fi
            AWS_REGION_NAME="${2}"
            shift 2
            ;;
        --force)
            FORCE_MODE=true
            shift
            ;;
        *)
            if [[ -f "${1}" ]]; then
                CONFIG_FILE="${1}"
            else
                echo "Error: Unknown argument or file not found: ${1}" >&2
                usage
            fi
            shift
            ;;
    esac
done

# Function to destroy a stack
destroy_stack() {
    local stack_name=$1
    local profile=$2
    local region=$3
    
    echo "Destroying stack: ${stack_name}"
    
    export AWS_PROFILE="${profile}"
    export AWS_REGION="${region}"
    
    npx cdk destroy "${stack_name}" --force
    
    echo "Stack ${stack_name} destroyed"
}

if [[ "${SINGLE_ACCOUNT_MODE}" == true ]]; then
    # Single account teardown
    echo "=========================================="
    echo "Single Account Teardown"
    echo "=========================================="
    
    # Set defaults for single account
    STACK_PREFIX="${STACK_PREFIX:-DTAZ}"
    AWS_PROFILE_NAME="${AWS_PROFILE_NAME:-default}"
    AWS_REGION_NAME="${AWS_REGION_NAME:-us-east-1}"
    
    STACK_NAME="${STACK_PREFIX}-SingleAccountStack"
    
    echo "Stack to delete: ${STACK_NAME}"
    echo "Profile: ${AWS_PROFILE_NAME}"
    echo "Region: ${AWS_REGION_NAME}"
    echo ""
    
    if [[ "${FORCE_MODE}" != true ]]; then
        echo "WARNING: This will permanently delete the following resources:"
        echo "  - VPC Flow Log configurations"
        echo "  - DynamoDB table with AZ mapping data"
        echo "  - All Lambda functions"
        echo "  - CloudTrail trail and S3 bucket contents"
        echo ""
        read -p "Are you sure you want to proceed? (yes/no): " CONFIRM
        if [[ "${CONFIRM}" != "yes" ]]; then
            echo "Teardown cancelled."
            exit 0
        fi
    fi
    
    echo ""
    cd "${PROJECT_ROOT}"
    
    export AWS_PROFILE="${AWS_PROFILE_NAME}"
    export AWS_REGION="${AWS_REGION_NAME}"
    
    npx cdk destroy "${STACK_NAME}" --force
    
    echo ""
    echo "=========================================="
    echo "Single Account Teardown Complete"
    echo "=========================================="
else
    # Multi-account teardown
    echo "=========================================="
    echo "Multi-Account Teardown"
    echo "=========================================="
    
    # Validate config file exists
    if [[ ! -f "${CONFIG_FILE}" ]]; then
        echo "Error: Configuration file not found: ${CONFIG_FILE}" >&2
        exit 1
    fi
    
    # Check for jq
    if ! command -v jq &> /dev/null; then
        echo "Error: jq is required but not installed" >&2
        exit 1
    fi
    
    # Read configuration
    STACK_PREFIX="${STACK_PREFIX:-$(jq -r '.stackPrefix // "DTAZ"' "${CONFIG_FILE}")}"
    HUB_ACCOUNT_ID=$(jq -r '.hubAccount.id' "${CONFIG_FILE}")
    HUB_PROFILE=$(jq -r '.hubAccount.profile' "${CONFIG_FILE}")
    HUB_REGION=$(jq -r '.hubAccount.region' "${CONFIG_FILE}")
    SPOKE_COUNT=$(jq '.spokeAccounts | length' "${CONFIG_FILE}")
    
    echo "Config file: ${CONFIG_FILE}"
    echo "Stack prefix: ${STACK_PREFIX}"
    echo "Hub account: ${HUB_ACCOUNT_ID}"
    echo "Number of spoke accounts: ${SPOKE_COUNT}"
    echo ""
    
    echo "Stacks to be deleted:"
    echo "  Hub: ${STACK_PREFIX}-HubStack (account: ${HUB_ACCOUNT_ID})"
    for ((i = 0; i < SPOKE_COUNT; i++)); do
        SPOKE_ID=$(jq -r ".spokeAccounts[${i}].id" "${CONFIG_FILE}")
        echo "  Spoke: ${STACK_PREFIX}-SpokeStack-${SPOKE_ID}"
        echo "  PreRoles: ${STACK_PREFIX}-PreRolesStack-${SPOKE_ID}"
    done
    echo ""
    
    if [[ "${FORCE_MODE}" != true ]]; then
        echo "WARNING: This will permanently delete all stacks and resources!"
        echo "This includes:"
        echo "  - Hub account: DynamoDB table, Kinesis stream, Calculator Lambda"
        echo "  - Spoke accounts: VPC Flow Logs, CloudTrail trails, Lambda functions"
        echo ""
        read -p "Are you sure you want to proceed? (yes/no): " CONFIRM
        if [[ "${CONFIRM}" != "yes" ]]; then
            echo "Teardown cancelled."
            exit 0
        fi
    fi
    
    echo ""
    cd "${PROJECT_ROOT}"
    
    # Step 1: Delete Spoke stacks (parallel)
    echo "=========================================="
    echo "Step 1: Deleting Spoke Stacks"
    echo "=========================================="
    echo ""
    
    declare -a PIDS=()
    declare -a SPOKE_IDS=()
    
    for ((i = 0; i < SPOKE_COUNT; i++)); do
        SPOKE_ID=$(jq -r ".spokeAccounts[${i}].id" "${CONFIG_FILE}")
        SPOKE_PROFILE=$(jq -r ".spokeAccounts[${i}].profile" "${CONFIG_FILE}")
        SPOKE_REGION=$(jq -r ".spokeAccounts[${i}].region" "${CONFIG_FILE}")
        
        SPOKE_IDS+=("${SPOKE_ID}")
        
        echo "Starting deletion for spoke: ${SPOKE_ID}"
        
        LOG_FILE="${PROJECT_ROOT}/.spoke-teardown-${SPOKE_ID}.log"
        (
            # Set environment
            export AWS_PROFILE="${SPOKE_PROFILE}"
            export AWS_REGION="${SPOKE_REGION}"
            
            # Delete Spoke stack first
            SPOKE_STACK_NAME="${STACK_PREFIX}-SpokeStack-${SPOKE_ID}"
            echo "Deleting ${SPOKE_STACK_NAME}..."
            npx cdk destroy "${SPOKE_STACK_NAME}" --force || true
            
            # Delete PreRoles stack
            PRE_ROLES_STACK_NAME="${STACK_PREFIX}-PreRolesStack-${SPOKE_ID}"
            echo "Deleting ${PRE_ROLES_STACK_NAME}..."
            npx cdk destroy "${PRE_ROLES_STACK_NAME}" --force || true
            
            echo "Spoke ${SPOKE_ID} teardown complete"
        ) > "${LOG_FILE}" 2>&1 &
        PIDS+=($!)
    done
    
    echo ""
    echo "Waiting for spoke stack deletions to complete..."
    echo ""
    
    # Wait for all spoke deletions
    SPOKE_FAILURES=0
    for ((i = 0; i < ${#PIDS[@]}; i++)); do
        PID="${PIDS[i]}"
        SPOKE_ID="${SPOKE_IDS[i]}"
        LOG_FILE="${PROJECT_ROOT}/.spoke-teardown-${SPOKE_ID}.log"
        
        if wait "${PID}"; then
            echo "Spoke ${SPOKE_ID} teardown succeeded"
        else
            echo "Spoke ${SPOKE_ID} teardown had issues (check ${LOG_FILE})" >&2
            SPOKE_FAILURES=$((SPOKE_FAILURES + 1))
        fi
    done
    
    echo ""
    
    # Step 2: Delete Hub stack
    echo "=========================================="
    echo "Step 2: Deleting Hub Stack"
    echo "=========================================="
    echo ""
    
    export AWS_PROFILE="${HUB_PROFILE}"
    export AWS_REGION="${HUB_REGION}"
    
    HUB_STACK_NAME="${STACK_PREFIX}-HubStack"
    echo "Deleting ${HUB_STACK_NAME}..."
    npx cdk destroy "${HUB_STACK_NAME}" --force
    
    echo ""
    echo "Hub stack deleted"
    
    # Clean up local files
    rm -f "${PROJECT_ROOT}/.hub-outputs.json"
    rm -f "${PROJECT_ROOT}/.spoke-deploy-"*.log
    rm -f "${PROJECT_ROOT}/.spoke-teardown-"*.log
    
    echo ""
    echo "=========================================="
    echo "Multi-Account Teardown Complete"
    echo "=========================================="
    
    if [[ ${SPOKE_FAILURES} -gt 0 ]]; then
        echo "Warning: ${SPOKE_FAILURES} spoke teardown(s) had issues."
        echo "Check log files for details."
        exit 1
    fi
fi
