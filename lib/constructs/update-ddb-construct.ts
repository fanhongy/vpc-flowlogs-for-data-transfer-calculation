/**
 * Update DynamoDB Construct
 *
 * Creates a Lambda function that listens to CloudTrail CreateSubnet events
 * and updates the DynamoDB table with new subnet-to-AZ mappings.
 * This ensures the AZ mapping table stays current as new subnets are created.
 *
 * Resources created:
 * - Lambda function (Python 3.11) for processing CreateSubnet events
 * - IAM role for Lambda execution with DynamoDB, logs, and STS permissions
 * - Lambda permission for CloudWatch Logs invocation
 * - Subscription filter on CloudTrail log group
 *
 * Based on CloudFormation resources from single-account-deployment.yml:
 * - rUpdateDDbLambdaExecRole
 * - rUpdateDDBLambdaPermissions
 * - rUpdateDDBLambda
 * - rSubscriptionFilter
 */

import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as logsDestinations from 'aws-cdk-lib/aws-logs-destinations';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Duration } from 'aws-cdk-lib';

/**
 * Props for UpdateDdbConstruct
 */
export interface UpdateDdbProps {
  /**
   * The CloudWatch Log Group from CloudTrail that contains CreateSubnet events.
   * The subscription filter will be created on this log group.
   */
  readonly cloudTrailLogGroup: logs.ILogGroup;

  /**
   * Optional IAM role ARN for cross-account DynamoDB access.
   * When specified, the Lambda will use this role to write to a
   * DynamoDB table in a central/hub account.
   * Passed as CENTRAL_ACCOUNT_ROLE environment variable.
   */
  readonly centralAccountRoleArn?: string;
}

/**
 * Construct that creates infrastructure to update DynamoDB on CreateSubnet events.
 *
 * This construct sets up a Lambda function that is triggered by CloudTrail
 * CreateSubnet events via a CloudWatch Logs subscription filter. When a new
 * subnet is created in the account, the Lambda extracts the subnet ID, CIDR,
 * and availability zone information and adds it to the DynamoDB mapping table.
 *
 * For multi-account deployments, the centralAccountRoleArn prop enables the
 * Lambda to assume a role in the hub account to access the central DynamoDB table.
 */
export class UpdateDdbConstruct extends Construct {
  /**
   * The Lambda function that processes CreateSubnet events
   */
  public readonly lambda: lambda.Function;

  /**
   * The IAM role for the Lambda function
   */
  public readonly lambdaRole: iam.Role;

  /**
   * The subscription filter on the CloudTrail log group
   */
  public readonly subscriptionFilter: logs.SubscriptionFilter;

  constructor(scope: Construct, id: string, props: UpdateDdbProps) {
    super(scope, id);

    const { cloudTrailLogGroup, centralAccountRoleArn } = props;

    // Create IAM role for the Lambda function
    this.lambdaRole = new iam.Role(this, 'LambdaExecRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for Update DynamoDB Lambda',
    });

    // Add CloudWatch Logs permissions
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'logs:*',
        ],
        resources: ['arn:aws:logs:*:*:*'],
      })
    );

    // Add DynamoDB permissions
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:*'],
        resources: ['*'],
      })
    );

    // Add S3 permissions (may be needed for some operations)
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:*'],
        resources: ['*'],
      })
    );

    // Add STS AssumeRole permission for cross-account access
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: ['*'],
      })
    );

    // Build environment variables for the Lambda
    const environment: Record<string, string> = {};
    if (centralAccountRoleArn) {
      environment['CENTRAL_ACCOUNT_ROLE'] = centralAccountRoleArn;
    }

    // Create the Lambda function
    this.lambda = new lambda.Function(this, 'UpdateDDBLambda', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset('lambda/update-ddb-table'),
      role: this.lambdaRole,
      timeout: Duration.seconds(150),
      description: 'Lambda to update DynamoDB table on CreateSubnet CloudTrail events',
      environment: Object.keys(environment).length > 0 ? environment : undefined,
    });

    // Create subscription filter on CloudTrail log group
    // This triggers the Lambda when CreateSubnet events are logged
    this.subscriptionFilter = new logs.SubscriptionFilter(this, 'SubscriptionFilter', {
      logGroup: cloudTrailLogGroup,
      destination: new logsDestinations.LambdaDestination(this.lambda),
      filterPattern: logs.FilterPattern.literal('CreateSubnet'),
    });
  }
}
