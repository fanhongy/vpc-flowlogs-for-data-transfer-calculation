# Deployment Guide

This guide provides detailed step-by-step instructions for deploying the VPC Flow Logs Data Transfer Calculation solution.

## Table of Contents

- [Prerequisites Checklist](#prerequisites-checklist)
- [Single-Account Deployment](#single-account-deployment)
- [Multi-Account Deployment](#multi-account-deployment)
  - [Manual Deployment](#manual-multi-account-deployment)
  - [Automated Deployment](#automated-multi-account-deployment)
- [AWS Organizations Considerations](#aws-organizations-considerations)
- [Post-Deployment Verification](#post-deployment-verification)

## Prerequisites Checklist

Before starting, verify all prerequisites are met:

### Required Software

```bash
# Check Node.js (18+)
node --version

# Check AWS CDK CLI
cdk --version

# Check Python (3.11+)
python3 --version

# Check AWS CLI
aws --version

# Check jq
jq --version
```

### AWS Setup

- [ ] AWS CLI configured with credentials (`aws configure`)
- [ ] Appropriate IAM permissions (CloudFormation, IAM, Lambda, DynamoDB, etc.)
- [ ] CDK bootstrapped in target account/region

```bash
# Bootstrap CDK (one-time per account/region)
cdk bootstrap aws://ACCOUNT_ID/REGION
```

### Project Setup

```bash
# Clone the repository
git clone https://github.com/aws-samples/vpc-flowlogs-for-data-transfer-calculation.git
cd vpc-flowlogs-for-data-transfer-calculation

# Install dependencies
npm install
```

## Single-Account Deployment

Use this deployment pattern when all VPCs to monitor are in a single AWS account.

### Step 1: Identify VPCs to Monitor

List your VPCs:

```bash
aws ec2 describe-vpcs --query 'Vpcs[*].[VpcId,Tags[?Key==`Name`].Value|[0]]' --output table
```

### Step 2: Bootstrap CDK (if not done)

```bash
export AWS_PROFILE=my-profile  # Optional: set AWS profile
export AWS_REGION=us-east-1    # Set region

cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/$AWS_REGION
```

### Step 3: Deploy the Stack

Using the deployment script:

```bash
./scripts/deploy-single-account.sh --vpc-ids vpc-12345678
```

Or with additional options:

```bash
./scripts/deploy-single-account.sh \
  --vpc-ids vpc-aaaa1111,vpc-bbbb2222 \
  --profile my-profile \
  --region us-west-2 \
  --prefix MYAPP
```

### Step 4: Verify Deployment

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name DTAZ-SingleAccountStack \
  --query 'Stacks[0].StackStatus'

# List stack outputs
aws cloudformation describe-stacks \
  --stack-name DTAZ-SingleAccountStack \
  --query 'Stacks[0].Outputs'
```

### Step 5: Test the Setup

Generate some traffic in your VPC, then check the Calculator Lambda logs:

```bash
# Get the log group name
LOG_GROUP=$(aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/DTAZ" \
  --query 'logGroups[?contains(logGroupName, `Calculator`)].logGroupName' \
  --output text)

# View recent logs
aws logs tail $LOG_GROUP --since 1h
```

## Multi-Account Deployment

Use this deployment pattern when you have multiple AWS accounts with VPCs to monitor.

### Architecture Overview

```
Hub Account (Central)
  - DynamoDB table
  - Kinesis stream
  - Calculator Lambda
  - CloudWatch Logs destination

Spoke Account(s)
  - VPC Flow Logs
  - CloudTrail
  - UpdateDDB Lambda (writes to Hub DDB)
  - LoadDDB Lambda (initial data load)
```

### Manual Multi-Account Deployment

#### Step 1: Prepare Configuration

Create your deployment configuration:

```bash
cp deploy-config.example.json deploy-config.json
```

Edit `deploy-config.json`:

```json
{
  "hubAccount": {
    "id": "111111111111",
    "region": "us-east-1",
    "profile": "hub-profile",
    "lambdaCodeBucket": "my-lambda-bucket-hub"
  },
  "spokeAccounts": [
    {
      "id": "222222222222",
      "region": "us-east-1",
      "profile": "spoke1-profile",
      "vpcIds": ["vpc-aaaa1111", "vpc-bbbb2222"],
      "lambdaCodeBucket": "my-lambda-bucket-spoke1"
    },
    {
      "id": "333333333333",
      "region": "us-west-2",
      "profile": "spoke2-profile",
      "vpcIds": ["vpc-cccc3333"],
      "lambdaCodeBucket": "my-lambda-bucket-spoke2"
    }
  ],
  "stackPrefix": "DTAZ"
}
```

#### Step 2: Bootstrap CDK in All Accounts

```bash
# Bootstrap hub account
export AWS_PROFILE=hub-profile
cdk bootstrap aws://111111111111/us-east-1

# Bootstrap spoke accounts
export AWS_PROFILE=spoke1-profile
cdk bootstrap aws://222222222222/us-east-1

export AWS_PROFILE=spoke2-profile
cdk bootstrap aws://333333333333/us-west-2
```

#### Step 3: Deploy Hub Stack

```bash
./scripts/deploy-hub.sh deploy-config.json
```

This creates:
- DynamoDB table for AZ mappings
- Kinesis stream for aggregating flow logs
- CloudWatch Logs destination for spoke subscriptions
- Calculator Lambda for processing flow logs
- IAM role for spoke accounts to access DynamoDB

**Important**: The script saves hub outputs to `.hub-outputs.json` for spoke deployments.

#### Step 4: Deploy PreRoles to Each Spoke Account

For each spoke account, deploy the PreRoles stack first:

```bash
# Spoke 1
export AWS_PROFILE=spoke1-profile
npx cdk deploy DTAZ-PreRolesStack-222222222222 \
  -c centralAccountId=111111111111

# Spoke 2
export AWS_PROFILE=spoke2-profile
npx cdk deploy DTAZ-PreRolesStack-333333333333 \
  -c centralAccountId=111111111111
```

Or use the spoke deployment script which handles this:

```bash
./scripts/deploy-spoke.sh 0 deploy-config.json  # First spoke (index 0)
./scripts/deploy-spoke.sh 1 deploy-config.json  # Second spoke (index 1)
```

#### Step 5: Deploy Spoke Stacks

The spoke deployment script deploys both PreRoles and Spoke stacks:

```bash
./scripts/deploy-spoke.sh 0  # Deploy first spoke account
./scripts/deploy-spoke.sh 1  # Deploy second spoke account
```

#### Step 6: Verify All Stacks

```bash
# Check hub stack
export AWS_PROFILE=hub-profile
aws cloudformation describe-stacks --stack-name DTAZ-HubStack

# Check spoke stacks
export AWS_PROFILE=spoke1-profile
aws cloudformation describe-stacks --stack-name DTAZ-SpokeStack-222222222222
```

### Automated Multi-Account Deployment

The `deploy-all.sh` script orchestrates the entire multi-account deployment:

#### Step 1: Prepare Configuration

```bash
cp deploy-config.example.json deploy-config.json
# Edit deploy-config.json with your account details
```

#### Step 2: Run Automated Deployment

```bash
# Deploy all (parallel spoke deployment)
./scripts/deploy-all.sh

# Or deploy sequentially (useful for debugging)
./scripts/deploy-all.sh --sequential

# Use custom config file
./scripts/deploy-all.sh my-config.json
```

The script will:
1. Deploy the Hub stack first
2. Capture hub outputs (destination ARN, DDB role ARN)
3. Deploy all spoke stacks (in parallel by default)
4. Report success/failure summary

#### Step 3: Monitor Progress

For parallel deployments, check individual log files:

```bash
# View spoke deployment logs
tail -f .spoke-deploy-222222222222.log
tail -f .spoke-deploy-333333333333.log
```

## AWS Organizations Considerations

When deploying across an AWS Organization:

### Service Control Policies (SCPs)

Ensure SCPs allow:
- CloudFormation operations
- IAM role creation
- Cross-account AssumeRole
- CloudWatch Logs cross-account destinations

### Resource Access Manager (RAM)

For sharing resources across accounts, consider:
- Sharing the CloudWatch Logs destination via RAM
- Centralized CloudTrail with organization trail

### Deployment Strategies

#### Option 1: Admin Account Deploys All

Use a central admin account with cross-account deployment roles:

```bash
# Assume deployment role in each account
aws sts assume-role --role-arn arn:aws:iam::222222222222:role/DeploymentRole
```

#### Option 2: Each Account Deploys Own Stack

Distribute the CDK project to each account and deploy locally:

```bash
# In each spoke account
./scripts/deploy-spoke.sh 0 deploy-config.json
```

#### Option 3: CI/CD Pipeline

Use AWS CodePipeline with cross-account deployment:

1. Source stage: Git repository
2. Build stage: Synthesize CDK
3. Deploy stages: Deploy to each account

### Stack Naming Conventions

Use the `stackPrefix` parameter to organize stacks:

```json
{
  "stackPrefix": "DTAZ-Prod"
}
```

This creates stacks named:
- `DTAZ-Prod-HubStack`
- `DTAZ-Prod-PreRolesStack-222222222222`
- `DTAZ-Prod-SpokeStack-222222222222`

## Post-Deployment Verification

### 1. Verify DynamoDB Table Population

```bash
# Hub account
export AWS_PROFILE=hub-profile

aws dynamodb scan \
  --table-name AZsMapping \
  --max-items 10
```

Expected: Table contains subnet-to-AZ mappings from all spoke accounts.

### 2. Verify CloudWatch Logs Subscription

```bash
# Spoke account
export AWS_PROFILE=spoke1-profile

aws logs describe-subscription-filters \
  --log-group-name "/aws/vpc-flow-logs"
```

Expected: Subscription filter pointing to hub destination.

### 3. Test Cross-AZ Traffic Detection

1. Generate traffic between subnets in different AZs
2. Wait 5-10 minutes for flow logs to process
3. Check Calculator Lambda logs:

```bash
export AWS_PROFILE=hub-profile

LOG_GROUP=$(aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/DTAZ" \
  --query 'logGroups[?contains(logGroupName, `Calculator`)].logGroupName' \
  --output text)

aws logs filter-log-events \
  --log-group-name $LOG_GROUP \
  --filter-pattern "srcAZ" \
  --max-items 10
```

### 4. Verify CloudTrail Integration

Create a test subnet and verify DynamoDB is updated:

```bash
# Create a test subnet (in spoke account)
export AWS_PROFILE=spoke1-profile

aws ec2 create-subnet \
  --vpc-id vpc-aaaa1111 \
  --cidr-block 10.0.99.0/24 \
  --availability-zone us-east-1a

# Wait 1-2 minutes, then check DynamoDB (hub account)
export AWS_PROFILE=hub-profile

aws dynamodb query \
  --table-name AZsMapping \
  --key-condition-expression "begins_with(VpcIdCidr, :vpc)" \
  --expression-attribute-values '{":vpc":{"S":"vpc-aaaa1111"}}'
```

### 5. Set Up CloudWatch Contributor Insights

Follow the instructions in the [README](../README.md#5-configure-cloudwatch-contributor-insights) to set up visualization dashboards.

## Rollback and Cleanup

### Delete Single-Account Deployment

```bash
./scripts/teardown.sh --single-account
```

### Delete Multi-Account Deployment

```bash
./scripts/teardown.sh  # Uses deploy-config.json
```

Or manually:

```bash
# Delete spoke stacks first (order matters!)
export AWS_PROFILE=spoke1-profile
cdk destroy DTAZ-SpokeStack-222222222222
cdk destroy DTAZ-PreRolesStack-222222222222

# Then delete hub stack
export AWS_PROFILE=hub-profile
cdk destroy DTAZ-HubStack
```

**Important**: Always delete spoke stacks before the hub stack to avoid orphaned cross-account references.
