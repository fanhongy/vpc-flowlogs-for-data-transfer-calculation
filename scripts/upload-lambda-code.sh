#!/usr/bin/env bash
#
# upload-lambda-code.sh - Upload Lambda code to S3 for deployment
#
# This script creates zip files from Lambda function directories and uploads
# them to an S3 bucket. This is useful for S3-based Lambda deployment instead
# of inline code deployment.
#
# Usage: ./scripts/upload-lambda-code.sh <bucket-name> [options]
#
# Options:
#   bucket-name       S3 bucket name to upload Lambda code to (required)
#   --profile <name>  AWS profile to use (default: default)
#   --region <region> AWS region (default: us-east-1)
#   --prefix <prefix> S3 key prefix for uploaded files (default: lambda/)
#
# Prerequisites:
# - AWS CLI configured with appropriate credentials
# - zip command available
# - S3 bucket must exist

set -euo pipefail

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LAMBDA_DIR="${PROJECT_ROOT}/lambda"

# Default values
BUCKET_NAME=""
AWS_PROFILE_NAME="default"
AWS_REGION_NAME="us-east-1"
S3_PREFIX="lambda/"

usage() {
    echo "Usage: $(basename "$0") <bucket-name> [options]"
    echo ""
    echo "Upload Lambda code to S3 for deployment."
    echo ""
    echo "Arguments:"
    echo "  bucket-name       S3 bucket name to upload Lambda code to (required)"
    echo ""
    echo "Options:"
    echo "  --profile <name>  AWS profile to use (default: default)"
    echo "  --region <region> AWS region (default: us-east-1)"
    echo "  --prefix <prefix> S3 key prefix for uploaded files (default: lambda/)"
    echo "  -h, --help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $(basename "$0") my-lambda-bucket"
    echo "  $(basename "$0") my-bucket --profile prod --region us-west-2"
    echo "  $(basename "$0") my-bucket --prefix code/lambdas/"
    echo ""
    echo "Lambda functions uploaded:"
    echo "  - calculator"
    echo "  - create-vpc-flowlogs"
    echo "  - load-az-cidr"
    echo "  - update-ddb-table"
    exit 1
}

# Parse arguments
if [[ $# -eq 0 ]]; then
    usage
fi

while [[ $# -gt 0 ]]; do
    case "${1}" in
        -h|--help)
            usage
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
            S3_PREFIX="${2}"
            shift 2
            ;;
        -*)
            echo "Error: Unknown option: ${1}" >&2
            usage
            ;;
        *)
            if [[ -z "${BUCKET_NAME}" ]]; then
                BUCKET_NAME="${1}"
            else
                echo "Error: Unexpected argument: ${1}" >&2
                usage
            fi
            shift
            ;;
    esac
done

# Validate required arguments
if [[ -z "${BUCKET_NAME}" ]]; then
    echo "Error: bucket-name is required" >&2
    usage
fi

# Check for zip command
if ! command -v zip &> /dev/null; then
    echo "Error: zip command is required but not installed" >&2
    exit 1
fi

# Validate lambda directory exists
if [[ ! -d "${LAMBDA_DIR}" ]]; then
    echo "Error: Lambda directory not found: ${LAMBDA_DIR}" >&2
    exit 1
fi

echo "=========================================="
echo "Upload Lambda Code to S3"
echo "=========================================="
echo "Bucket: ${BUCKET_NAME}"
echo "Prefix: ${S3_PREFIX}"
echo "Profile: ${AWS_PROFILE_NAME}"
echo "Region: ${AWS_REGION_NAME}"
echo ""

# Set AWS environment
export AWS_PROFILE="${AWS_PROFILE_NAME}"
export AWS_REGION="${AWS_REGION_NAME}"

# Create temporary directory for zip files
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "${TEMP_DIR}"' EXIT

echo "Creating Lambda zip files..."
echo ""

# Lambda functions to upload
LAMBDA_FUNCTIONS=(
    "calculator"
    "create-vpc-flowlogs"
    "load-az-cidr"
    "update-ddb-table"
)

UPLOAD_COUNT=0

for FUNC_NAME in "${LAMBDA_FUNCTIONS[@]}"; do
    FUNC_DIR="${LAMBDA_DIR}/${FUNC_NAME}"
    
    if [[ ! -d "${FUNC_DIR}" ]]; then
        echo "Warning: Lambda directory not found, skipping: ${FUNC_DIR}" >&2
        continue
    fi
    
    ZIP_FILE="${TEMP_DIR}/${FUNC_NAME}.zip"
    S3_KEY="${S3_PREFIX}${FUNC_NAME}.zip"
    
    echo "Processing: ${FUNC_NAME}"
    echo "  Source: ${FUNC_DIR}"
    echo "  Zip: ${ZIP_FILE}"
    
    # Create zip file from lambda directory
    (
        cd "${FUNC_DIR}"
        zip -r "${ZIP_FILE}" . -x "*.pyc" -x "__pycache__/*" -x ".pytest_cache/*" > /dev/null
    )
    
    # Get zip file size
    ZIP_SIZE=$(du -h "${ZIP_FILE}" | cut -f1)
    echo "  Size: ${ZIP_SIZE}"
    
    # Upload to S3
    echo "  Uploading to s3://${BUCKET_NAME}/${S3_KEY}..."
    aws s3 cp "${ZIP_FILE}" "s3://${BUCKET_NAME}/${S3_KEY}" --quiet
    
    echo "  Done"
    echo ""
    
    UPLOAD_COUNT=$((UPLOAD_COUNT + 1))
done

echo "=========================================="
echo "Upload Complete"
echo "=========================================="
echo "Uploaded ${UPLOAD_COUNT} Lambda function(s)"
echo ""
echo "S3 Location: s3://${BUCKET_NAME}/${S3_PREFIX}"
echo ""
echo "To use these in CDK deployment, set the lambdaCodeBucket parameter"
echo "in your deploy-config.json to: ${BUCKET_NAME}"
echo "=========================================="
