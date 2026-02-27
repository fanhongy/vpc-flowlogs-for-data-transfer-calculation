#!/usr/bin/env bash
#
# deploy-single-account.sh - Deploy single-account VPC Flow Logs setup
#
# This script deploys the SingleAccountStack which creates all resources
# in a single AWS account:
# - VPC Flow Logs for specified VPCs
# - DynamoDB table for AZ mapping
# - Calculator Lambda with CloudWatch subscription
# - CloudTrail with UpdateDDB Lambda
# - LoadDDB custom resource
#
# Usage: ./scripts/deploy-single-account.sh --vpc-ids <comma-separated> [options]
#
# Options:
#   --vpc-ids <ids>    Comma-separated list of VPC IDs to monitor (required)
#   --profile <name>   AWS profile to use (default: default)
#   --region <region>  AWS region (default: us-east-1)
#   --prefix <prefix>  Stack name prefix (default: DTAZ)
#
# Prerequisites:
# - AWS CLI configured with appropriate credentials
# - CDK CLI installed (npx cdk)
# - Node.js dependencies installed (npm install)

set -euo pipefail

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default values
VPC_IDS=""
AWS_PROFILE_NAME="default"
AWS_REGION_NAME="us-east-1"
STACK_PREFIX="DTAZ"

usage() {
    echo "Usage: $(basename "$0") --vpc-ids <comma-separated> [options]"
    echo ""
    echo "Deploy single-account VPC Flow Logs setup."
    echo ""
    echo "Required:"
    echo "  --vpc-ids <ids>    Comma-separated list of VPC IDs to monitor"
    echo ""
    echo "Options:"
    echo "  --profile <name>   AWS profile to use (default: default)"
    echo "  --region <region>  AWS region (default: us-east-1)"
    echo "  --prefix <prefix>  Stack name prefix (default: DTAZ)"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  $(basename "$0") --vpc-ids vpc-12345678"
    echo "  $(basename "$0") --vpc-ids vpc-111,vpc-222 --profile my-profile"
    echo "  $(basename "$0") --vpc-ids vpc-aaa --region us-west-2 --prefix MYAPP"
    exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "${1}" in
        -h|--help)
            usage
            ;;
        --vpc-ids)
            if [[ -z "${2:-}" ]]; then
                echo "Error: --vpc-ids requires a value" >&2
                exit 1
            fi
            VPC_IDS="${2}"
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
        --prefix)
            if [[ -z "${2:-}" ]]; then
                echo "Error: --prefix requires a value" >&2
                exit 1
            fi
            STACK_PREFIX="${2}"
            shift 2
            ;;
        *)
            echo "Error: Unknown argument: ${1}" >&2
            usage
            ;;
    esac
done

# Validate required arguments
if [[ -z "${VPC_IDS}" ]]; then
    echo "Error: --vpc-ids is required" >&2
    usage
fi

echo "=========================================="
echo "Single Account Deployment"
echo "=========================================="
echo "VPC IDs: ${VPC_IDS}"
echo "AWS Profile: ${AWS_PROFILE_NAME}"
echo "AWS Region: ${AWS_REGION_NAME}"
echo "Stack Prefix: ${STACK_PREFIX}"
echo ""

# Set AWS profile
export AWS_PROFILE="${AWS_PROFILE_NAME}"
export AWS_REGION="${AWS_REGION_NAME}"

echo "Using AWS Profile: ${AWS_PROFILE}"
echo "Using AWS Region: ${AWS_REGION}"
echo ""

# Change to project root
cd "${PROJECT_ROOT}"

# Deploy SingleAccountStack
STACK_NAME="${STACK_PREFIX}-SingleAccountStack"
echo "Deploying stack: ${STACK_NAME}"
echo ""

npx cdk deploy "${STACK_NAME}" \
    --require-approval never \
    -c vpcIds="${VPC_IDS}"

echo ""
echo "=========================================="
echo "Single Account Deployment Complete"
echo "=========================================="
echo "Stack: ${STACK_NAME}"
echo "VPCs monitored: ${VPC_IDS}"
echo ""
echo "To view calculated data transfer costs, check the DynamoDB table"
echo "and CloudWatch Logs for the Calculator Lambda function."
echo "=========================================="
