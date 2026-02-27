#!/usr/bin/env bash
#
# deploy-all.sh - Master orchestration for multi-account VPC Flow Logs deployment
#
# This script orchestrates the complete multi-account deployment:
# 1. Deploys Hub stack first
# 2. Deploys all Spoke stacks (parallel by default, sequential with --sequential)
#
# Usage: ./scripts/deploy-all.sh [config-file] [--sequential]
#   config-file:  Path to deployment config JSON (default: deploy-config.json)
#   --sequential: Deploy spoke stacks one at a time instead of in parallel
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
CONFIG_FILE="${PROJECT_ROOT}/deploy-config.json"
SEQUENTIAL_MODE=false

usage() {
    echo "Usage: $(basename "$0") [config-file] [--sequential]"
    echo ""
    echo "Master orchestration for multi-account VPC Flow Logs deployment."
    echo ""
    echo "Arguments:"
    echo "  config-file   Path to deployment config JSON (default: deploy-config.json)"
    echo "  --sequential  Deploy spoke stacks one at a time instead of in parallel"
    echo ""
    echo "Examples:"
    echo "  $(basename "$0")                          # Deploy all with default config"
    echo "  $(basename "$0") --sequential             # Deploy sequentially"
    echo "  $(basename "$0") my-config.json           # Use custom config"
    echo "  $(basename "$0") my-config.json --sequential"
    exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "${1}" in
        -h|--help)
            usage
            ;;
        --sequential)
            SEQUENTIAL_MODE=true
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
echo "Multi-Account Deployment Orchestration"
echo "=========================================="
echo "Config file: ${CONFIG_FILE}"
echo "Sequential mode: ${SEQUENTIAL_MODE}"
echo ""

# Read configuration summary
HUB_ACCOUNT_ID=$(jq -r '.hubAccount.id' "${CONFIG_FILE}")
HUB_REGION=$(jq -r '.hubAccount.region' "${CONFIG_FILE}")
SPOKE_COUNT=$(jq '.spokeAccounts | length' "${CONFIG_FILE}")
STACK_PREFIX=$(jq -r '.stackPrefix // "DTAZ"' "${CONFIG_FILE}")

echo "Hub Account: ${HUB_ACCOUNT_ID} (${HUB_REGION})"
echo "Number of Spoke Accounts: ${SPOKE_COUNT}"
echo "Stack Prefix: ${STACK_PREFIX}"
echo ""

# Track deployment status
DEPLOYMENT_START_TIME=$(date +%s)
declare -a FAILED_SPOKES=()
declare -a SUCCESSFUL_SPOKES=()

# Function to deploy a spoke and track result
deploy_spoke() {
    local spoke_index=$1
    local spoke_id
    spoke_id=$(jq -r ".spokeAccounts[${spoke_index}].id" "${CONFIG_FILE}")
    
    echo "Starting deployment for spoke ${spoke_id} (index: ${spoke_index})..."
    
    if "${SCRIPT_DIR}/deploy-spoke.sh" "${spoke_index}" "${CONFIG_FILE}"; then
        echo "Spoke ${spoke_id} deployment succeeded"
        return 0
    else
        echo "Spoke ${spoke_id} deployment failed" >&2
        return 1
    fi
}

# Step 1: Deploy Hub stack
echo "=========================================="
echo "Step 1: Deploying Hub Stack"
echo "=========================================="
echo ""

if ! "${SCRIPT_DIR}/deploy-hub.sh" "${CONFIG_FILE}"; then
    echo ""
    echo "ERROR: Hub stack deployment failed!" >&2
    echo "Cannot proceed with spoke deployments." >&2
    exit 1
fi

echo ""
echo "Hub stack deployment successful!"
echo ""

# Step 2: Deploy Spoke stacks
echo "=========================================="
echo "Step 2: Deploying Spoke Stacks"
echo "=========================================="
echo ""

if [[ "${SEQUENTIAL_MODE}" == true ]]; then
    # Sequential deployment
    echo "Deploying spoke stacks sequentially..."
    echo ""
    
    for ((i = 0; i < SPOKE_COUNT; i++)); do
        SPOKE_ID=$(jq -r ".spokeAccounts[${i}].id" "${CONFIG_FILE}")
        echo "------------------------------------------"
        echo "Deploying spoke ${i + 1}/${SPOKE_COUNT}: ${SPOKE_ID}"
        echo "------------------------------------------"
        
        if deploy_spoke "${i}"; then
            SUCCESSFUL_SPOKES+=("${SPOKE_ID}")
        else
            FAILED_SPOKES+=("${SPOKE_ID}")
            echo "Warning: Continuing with next spoke despite failure..." >&2
        fi
        echo ""
    done
else
    # Parallel deployment
    echo "Deploying spoke stacks in parallel..."
    echo ""
    
    declare -a PIDS=()
    declare -a SPOKE_IDS=()
    
    # Start all spoke deployments in background
    for ((i = 0; i < SPOKE_COUNT; i++)); do
        SPOKE_ID=$(jq -r ".spokeAccounts[${i}].id" "${CONFIG_FILE}")
        SPOKE_IDS+=("${SPOKE_ID}")
        
        echo "Starting background deployment for spoke: ${SPOKE_ID}"
        
        # Run deployment in background, redirecting output to log file
        LOG_FILE="${PROJECT_ROOT}/.spoke-deploy-${SPOKE_ID}.log"
        (
            deploy_spoke "${i}" > "${LOG_FILE}" 2>&1
        ) &
        PIDS+=($!)
    done
    
    echo ""
    echo "Waiting for all spoke deployments to complete..."
    echo ""
    
    # Wait for all deployments and collect results
    for ((i = 0; i < ${#PIDS[@]}; i++)); do
        PID="${PIDS[i]}"
        SPOKE_ID="${SPOKE_IDS[i]}"
        LOG_FILE="${PROJECT_ROOT}/.spoke-deploy-${SPOKE_ID}.log"
        
        if wait "${PID}"; then
            echo "Spoke ${SPOKE_ID} deployment succeeded"
            SUCCESSFUL_SPOKES+=("${SPOKE_ID}")
        else
            echo "Spoke ${SPOKE_ID} deployment failed" >&2
            echo "Check log file: ${LOG_FILE}" >&2
            FAILED_SPOKES+=("${SPOKE_ID}")
        fi
    done
fi

# Calculate deployment duration
DEPLOYMENT_END_TIME=$(date +%s)
DEPLOYMENT_DURATION=$((DEPLOYMENT_END_TIME - DEPLOYMENT_START_TIME))
DURATION_MINUTES=$((DEPLOYMENT_DURATION / 60))
DURATION_SECONDS=$((DEPLOYMENT_DURATION % 60))

# Summary
echo ""
echo "=========================================="
echo "Deployment Summary"
echo "=========================================="
echo ""
echo "Duration: ${DURATION_MINUTES}m ${DURATION_SECONDS}s"
echo ""
echo "Hub Stack: Deployed successfully"
echo ""
echo "Spoke Stacks:"
echo "  Successful: ${#SUCCESSFUL_SPOKES[@]}"
for spoke in "${SUCCESSFUL_SPOKES[@]:-}"; do
    [[ -n "${spoke}" ]] && echo "    - ${spoke}"
done

if [[ ${#FAILED_SPOKES[@]} -gt 0 ]]; then
    echo "  Failed: ${#FAILED_SPOKES[@]}"
    for spoke in "${FAILED_SPOKES[@]}"; do
        echo "    - ${spoke}"
    done
    echo ""
    echo "Some spoke deployments failed. Check the log files for details."
    exit 1
fi

echo ""
echo "=========================================="
echo "All Deployments Completed Successfully!"
echo "=========================================="
