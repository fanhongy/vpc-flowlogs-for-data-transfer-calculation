# Troubleshooting Guide

This guide covers common issues and solutions when deploying or operating the VPC Flow Logs Data Transfer Calculation solution.

## Table of Contents

- [CDK Bootstrap Errors](#cdk-bootstrap-errors)
- [Cross-Account Role Trust Issues](#cross-account-role-trust-issues)
- [VPC Flow Logs Not Appearing](#vpc-flow-logs-not-appearing)
- [DynamoDB Cross-Account Access Denied](#dynamodb-cross-account-access-denied)
- [CloudTrail Subscription Filter Not Triggering](#cloudtrail-subscription-filter-not-triggering)
- [Lambda Permission Errors](#lambda-permission-errors)
- [General Debugging Tips](#general-debugging-tips)

---

## CDK Bootstrap Errors

### Error: "This stack uses assets, so the toolkit stack must be deployed"

**Symptoms:**
```
Error: This stack uses assets, so the toolkit stack must be deployed to the environment
```

**Cause:** CDK bootstrap has not been run in the target account/region.

**Solution:**
```bash
# Bootstrap the account/region
cdk bootstrap aws://ACCOUNT_ID/REGION

# Example
cdk bootstrap aws://123456789012/us-east-1
```

### Error: "Access Denied" during bootstrap

**Symptoms:**
```
Error: Access Denied (Service: Amazon S3)
```

**Cause:** IAM permissions insufficient for bootstrap operations.

**Solution:**
Ensure your IAM user/role has these permissions:
- `cloudformation:*`
- `s3:*` (for CDK bootstrap bucket)
- `ecr:*` (for container assets)
- `ssm:GetParameter` (for version lookup)
- `iam:CreateRole`, `iam:AttachRolePolicy`

### Error: "Bootstrap stack version is outdated"

**Symptoms:**
```
This CDK deployment requires bootstrap stack version 'X', but found 'Y'
```

**Solution:**
```bash
# Re-bootstrap with latest version
cdk bootstrap aws://ACCOUNT_ID/REGION --force
```

---

## Cross-Account Role Trust Issues

### Error: "Unable to assume role" from spoke account

**Symptoms:**
```
botocore.exceptions.ClientError: An error occurred (AccessDenied) when calling the AssumeRole operation
```

**Cause:** The DDB role in the hub account does not trust the spoke account.

**Diagnosis:**
```bash
# Check the role trust policy (in hub account)
aws iam get-role --role-name DTAZ-HubStack-DDBRole* --query 'Role.AssumeRolePolicyDocument'
```

**Solution:**
Verify the spoke account ID is in the trust policy. The hub stack needs to be deployed with the correct `spokeAccountIds`:

```bash
# Re-deploy hub with correct spoke IDs
npx cdk deploy DTAZ-HubStack \
  -c spokeAccountIds="222222222222,333333333333"
```

### Error: "PreRolesStack must be deployed first"

**Symptoms:**
Spoke stack deployment fails with IAM role errors.

**Cause:** PreRolesStack creates execution roles required by SpokeStack.

**Solution:**
Deploy in the correct order:
```bash
# Step 1: Deploy PreRoles first
npx cdk deploy DTAZ-PreRolesStack-ACCOUNT_ID

# Step 2: Then deploy Spoke
npx cdk deploy DTAZ-SpokeStack-ACCOUNT_ID
```

### Error: "Cross-account subscription filter denied"

**Symptoms:**
```
Invalid parameter: destinationArn - Destination ARN is invalid
```

**Cause:** The CloudWatch Logs destination policy does not allow the spoke account.

**Diagnosis:**
```bash
# Check destination policy (in hub account)
aws logs describe-destinations --destination-name-prefix VPCFlowLogDst
```

**Solution:**
Ensure the hub stack was deployed with the spoke account in `spokeAccountIds`.

---

## VPC Flow Logs Not Appearing

### Issue: No logs in CloudWatch Logs group

**Diagnosis:**
```bash
# Check if flow logs exist for the VPC
aws ec2 describe-flow-logs --filter Name=resource-id,Values=vpc-12345678

# Check CloudWatch log group
aws logs describe-log-groups --log-group-name-prefix "/aws/vpc-flow-logs"

# Check for recent log streams
aws logs describe-log-streams \
  --log-group-name "/aws/vpc-flow-logs" \
  --order-by LastEventTime \
  --descending \
  --max-items 5
```

**Common Causes:**

1. **Flow logs not created**: Verify the VPC ID is correct in deployment
2. **No traffic**: Flow logs only appear when there's network traffic
3. **IAM role issues**: Flow logs role cannot write to CloudWatch

**Solution for IAM issues:**
```bash
# Check the flow logs role permissions
aws iam get-role-policy --role-name DTAZ-*-VpcFlowLogRole*
```

The role needs `logs:CreateLogStream` and `logs:PutLogEvents` permissions.

### Issue: Flow logs created but empty

**Cause:** No traffic matching the filter pattern.

**Test:** Generate traffic between instances in different subnets:
```bash
# SSH to an instance and ping another
ping -c 10 10.0.2.50
```

---

## DynamoDB Cross-Account Access Denied

### Error: "AccessDeniedException" when writing to DynamoDB

**Symptoms:**
```
AccessDeniedException: User: arn:aws:sts::222222222222:assumed-role/...
is not authorized to perform: dynamodb:PutItem on resource: arn:aws:dynamodb:us-east-1:111111111111:table/AZsMapping
```

**Diagnosis:**
```bash
# In spoke account, verify the Lambda can assume the hub role
aws sts assume-role \
  --role-arn arn:aws:iam::111111111111:role/DTAZ-HubStack-DDBRole* \
  --role-session-name test
```

**Common Causes:**

1. **Role ARN mismatch**: Spoke stack using wrong `centralAccountRoleArn`
2. **Trust policy missing spoke account**
3. **DDB role policy does not include table ARN**

**Solution:**
```bash
# Verify hub outputs file has correct role ARN
cat .hub-outputs.json

# Re-deploy spoke with correct role ARN
./scripts/deploy-spoke.sh 0
```

### Error: "Table not found"

**Symptoms:**
```
ResourceNotFoundException: Requested resource not found: Table: AZsMapping
```

**Cause:** DynamoDB table name mismatch or table in different region.

**Solution:**
Verify the table exists in the hub account's region:
```bash
aws dynamodb describe-table --table-name AZsMapping --region us-east-1
```

---

## CloudTrail Subscription Filter Not Triggering

### Issue: New subnets not appearing in DynamoDB

**Diagnosis:**
```bash
# Check CloudTrail log group
aws logs describe-log-groups --log-group-name-prefix "/aws/cloudtrail"

# Check for CreateSubnet events
aws logs filter-log-events \
  --log-group-name /aws/cloudtrail/DTAZ-CloudTrail \
  --filter-pattern "CreateSubnet" \
  --max-items 5

# Check UpdateDDB Lambda logs
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/DTAZ" | grep UpdateDdb
```

**Common Causes:**

1. **CloudTrail not logging**: Trail might be disabled or misconfigured
2. **Subscription filter pattern mismatch**
3. **Lambda not triggered**: Check Lambda CloudWatch metrics

**Solution:**
```bash
# Verify CloudTrail is logging
aws cloudtrail get-trail-status --name DTAZ-CloudTrail

# Check subscription filter
aws logs describe-subscription-filters \
  --log-group-name /aws/cloudtrail/DTAZ-CloudTrail
```

### Issue: Lambda triggered but DynamoDB not updated

**Diagnosis:**
```bash
# Check UpdateDDB Lambda logs for errors
LOG_GROUP=$(aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/DTAZ" \
  --query 'logGroups[?contains(logGroupName, `UpdateDdb`)].logGroupName' \
  --output text)

aws logs tail $LOG_GROUP --since 1h
```

**Common Causes:**

1. **Event parsing errors**: Log format changed
2. **Cross-account role assumption failed**
3. **Lambda timeout**: Increase timeout if needed

---

## Lambda Permission Errors

### Error: "Lambda execution role is invalid"

**Symptoms:**
```
InvalidParameterValueException: The role defined for the function cannot be assumed by Lambda
```

**Cause:** Lambda execution role trust policy does not allow Lambda service.

**Solution:**
The role trust policy must include:
```json
{
  "Effect": "Allow",
  "Principal": {
    "Service": "lambda.amazonaws.com"
  },
  "Action": "sts:AssumeRole"
}
```

### Error: "AccessDeniedException: ec2:DescribeSubnets"

**Symptoms:**
Lambda cannot describe subnets or other EC2 resources.

**Solution:**
Verify the Lambda role has EC2 describe permissions:
```bash
aws iam list-attached-role-policies --role-name DTAZ-*-LoadDdbLambdaRole*
```

### Error: "CloudWatch Logs access denied"

**Symptoms:**
Lambda logs not appearing in CloudWatch.

**Solution:**
Add CloudWatch Logs permissions to Lambda role:
- `logs:CreateLogGroup`
- `logs:CreateLogStream`
- `logs:PutLogEvents`

---

## General Debugging Tips

### Enable CDK Verbose Output

```bash
cdk deploy --verbose
```

### Check CloudFormation Events

```bash
aws cloudformation describe-stack-events \
  --stack-name DTAZ-SingleAccountStack \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`]'
```

### Validate CDK Synthesized Template

```bash
# Generate CloudFormation template without deploying
cdk synth DTAZ-SingleAccountStack > template.yaml

# Review the generated template
cat template.yaml | less
```

### Check Lambda Function Configuration

```bash
# List all Lambda functions from the stack
aws lambda list-functions \
  --query 'Functions[?starts_with(FunctionName, `DTAZ`)].[FunctionName,Runtime,Handler]' \
  --output table
```

### View Lambda Environment Variables

```bash
aws lambda get-function-configuration \
  --function-name DTAZ-CalculatorLambda \
  --query 'Environment.Variables'
```

### Test Lambda Manually

```bash
# Invoke Lambda with test event
aws lambda invoke \
  --function-name DTAZ-CalculatorLambda \
  --payload '{"test": true}' \
  --log-type Tail \
  response.json

# Decode and view logs
cat response.json
```

### Check IAM Role Policies

```bash
# List inline policies
aws iam list-role-policies --role-name ROLE_NAME

# List attached policies
aws iam list-attached-role-policies --role-name ROLE_NAME

# Get policy details
aws iam get-role-policy --role-name ROLE_NAME --policy-name POLICY_NAME
```

### Monitor CloudWatch Metrics

Key metrics to watch:
- Lambda: `Invocations`, `Errors`, `Duration`, `Throttles`
- DynamoDB: `ConsumedReadCapacityUnits`, `ConsumedWriteCapacityUnits`
- Kinesis: `GetRecords.IteratorAgeMilliseconds`, `PutRecord.Success`

```bash
# Get Lambda error count
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=DTAZ-CalculatorLambda \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Sum
```

### Reset and Re-deploy

If all else fails, perform a clean re-deployment:

```bash
# Delete the stack
./scripts/teardown.sh --force

# Wait for deletion to complete
aws cloudformation wait stack-delete-complete --stack-name DTAZ-SingleAccountStack

# Re-deploy
./scripts/deploy-single-account.sh --vpc-ids vpc-12345678
```

## Getting Help

If you continue to experience issues:

1. Check the [GitHub Issues](https://github.com/aws-samples/vpc-flowlogs-for-data-transfer-calculation/issues)
2. Review AWS documentation for specific services
3. Open a new issue with:
   - CDK and AWS CLI versions
   - Full error messages
   - Steps to reproduce
   - Relevant log excerpts
