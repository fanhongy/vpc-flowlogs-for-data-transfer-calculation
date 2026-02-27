/**
 * Single Account Stack
 *
 * Creates all infrastructure for VPC Flow Logs data transfer calculation
 * in a single AWS account deployment. This is an all-in-one stack that
 * includes everything needed for standalone operation.
 *
 * Based on CloudFormation template: single-account-deployment.yml
 *
 * Architecture:
 * - VPC Flow Logs for specified VPCs -> CloudWatch Logs
 * - Calculator Lambda triggered by CloudWatch Logs subscription filter
 * - DynamoDB table for AZ-to-subnet mapping
 * - CloudTrail for capturing CreateSubnet events
 * - UpdateDDB Lambda triggered by CloudTrail to maintain AZ mappings
 * - LoadDDB custom resource for initial data population
 *
 * Key difference from Hub Stack:
 * - Single account uses CloudWatch Logs subscription filter to trigger Calculator Lambda
 * - Hub (multi-account) uses Kinesis stream to aggregate logs from multiple spoke accounts
 */

import { Stack, StackProps, Duration, Aws, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as logsDestinations from 'aws-cdk-lib/aws-logs-destinations';
import * as iam from 'aws-cdk-lib/aws-iam';

import {
  AzMappingTableConstruct,
  VpcFlowLogsConstruct,
  CloudTrailConstruct,
  LoadDdbCustomResourceConstruct,
  UpdateDdbConstruct,
} from '../constructs';

/**
 * Props for SingleAccountStack
 */
export interface SingleAccountStackProps extends StackProps {
  /**
   * List of VPC IDs to monitor for flow logs.
   * Flow logs will be created for each VPC.
   */
  readonly vpcIds: string[];

  /**
   * S3 bucket containing Lambda code.
   * Note: In CDK, we use Code.fromAsset, but this prop maintains
   * compatibility with existing deployment scripts.
   * @optional
   */
  readonly lambdaCodeBucket?: string;

  /**
   * Optional existing CloudTrail S3 bucket name.
   * If not provided, a new bucket will be created.
   */
  readonly existingCloudTrailBucket?: string;

  /**
   * Optional central account role ARN for hybrid multi-account scenarios.
   * When specified, enables writing to a central DynamoDB table.
   */
  readonly centralAccountRole?: string;

  /**
   * Optional list of spoke account IDs for cross-account scenarios.
   * Used when this single-account deployment also serves as a hub.
   */
  readonly spokeAccountIds?: string[];
}

/**
 * Stack that creates all resources for single-account VPC Flow Logs data transfer calculation.
 *
 * This stack provides a complete, standalone solution for calculating cross-AZ
 * data transfer costs based on VPC flow logs. All resources are contained within
 * a single AWS account.
 *
 * Resources created:
 * - VPC Flow Logs infrastructure (log group, IAM roles, custom resource Lambda)
 * - AZ mapping DynamoDB table
 * - Calculator Lambda with CloudWatch Logs subscription filter
 * - CloudTrail with UpdateDDB Lambda for maintaining AZ mappings
 * - LoadDDB custom resource for initial data population
 */
export class SingleAccountStack extends Stack {
  /**
   * The AZ mapping DynamoDB table construct
   */
  public readonly azMappingTable: AzMappingTableConstruct;

  /**
   * The VPC Flow Logs construct
   */
  public readonly vpcFlowLogs: VpcFlowLogsConstruct;

  /**
   * The CloudTrail construct
   */
  public readonly cloudTrail: CloudTrailConstruct;

  /**
   * The Calculator Lambda function
   */
  public readonly calculatorLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: SingleAccountStackProps) {
    super(scope, id, props);

    const {
      vpcIds,
      existingCloudTrailBucket,
      centralAccountRole,
      spokeAccountIds,
    } = props;

    // Create the AZ mapping DynamoDB table
    this.azMappingTable = new AzMappingTableConstruct(this, 'AzMappingTable', {
      tableName: 'AZsMapping',
    });

    // Create VPC Flow Logs for specified VPCs
    this.vpcFlowLogs = new VpcFlowLogsConstruct(this, 'VpcFlowLogs', {
      vpcIds,
      logRetentionDays: 30,
    });

    // Create Calculator Lambda execution role
    const calculatorLambdaRole = new iam.Role(this, 'CalculatorLambdaExecRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      path: '/',
      description: 'Execution role for Calculator Lambda',
    });

    // Add CloudWatch Logs permissions
    calculatorLambdaRole.addToPolicy(
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

    // Add DynamoDB, S3, EC2 permissions
    calculatorLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:*', 's3:*', 'ec2:*'],
        resources: ['*'],
      })
    );

    // Build environment variables for Calculator Lambda
    const calculatorEnvironment: Record<string, string> = {
      CURRENT_ACCOUNT: Aws.ACCOUNT_ID,
      DDB_NAME: this.azMappingTable.tableName,
    };

    // Add spoke account IDs if provided (for hybrid scenarios)
    if (spokeAccountIds && spokeAccountIds.length > 0) {
      calculatorEnvironment['SPOKE_ACCOUNT_IDS'] = spokeAccountIds.join(',');
    }

    // Create Calculator Lambda function
    this.calculatorLambda = new lambda.Function(this, 'CalculatorLambda', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset('lambda/calculator'),
      role: calculatorLambdaRole,
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: calculatorEnvironment,
      description: 'Processes VPC flow logs and calculates cross-AZ data transfer',
    });

    // Create CloudWatch Logs subscription filter to trigger Calculator Lambda
    // This is the key difference from hub-stack which uses Kinesis
    // Filter pattern matches valid VPC flow log entries with actual IP addresses
    const flowLogFilterPattern = '[version, account_id, interface_id, srcaddr != "-", dstaddr != "-", srcport != "-", dstport != "-", protocol, packets, bytes, start, end, action, log_status]';

    new logs.SubscriptionFilter(this, 'VpcFlowLogSubscriptionFilter', {
      logGroup: this.vpcFlowLogs.logGroup,
      destination: new logsDestinations.LambdaDestination(this.calculatorLambda),
      filterPattern: logs.FilterPattern.literal(flowLogFilterPattern),
    });

    // Create CloudTrail infrastructure
    this.cloudTrail = new CloudTrailConstruct(this, 'CloudTrail', {
      existingBucketName: existingCloudTrailBucket,
      logRetentionDays: 30,
    });

    // Create UpdateDDB construct to maintain AZ mappings on CreateSubnet events
    new UpdateDdbConstruct(this, 'UpdateDdb', {
      cloudTrailLogGroup: this.cloudTrail.logGroup,
      centralAccountRoleArn: centralAccountRole,
    });

    // Create LoadDDB custom resource for initial data population
    new LoadDdbCustomResourceConstruct(this, 'LoadDdb', {
      centralAccountRoleArn: centralAccountRole,
    });

    // Stack outputs
    new CfnOutput(this, 'DynamoDBTableName', {
      value: this.azMappingTable.tableName,
      description: 'Name of the AZ mapping DynamoDB table',
      exportName: `${this.stackName}-DDBTableName`,
    });

    new CfnOutput(this, 'FlowLogGroupArn', {
      value: this.vpcFlowLogs.logGroupArn,
      description: 'ARN of the VPC Flow Logs CloudWatch Log Group',
      exportName: `${this.stackName}-FlowLogGroupArn`,
    });

    new CfnOutput(this, 'CalculatorLambdaArn', {
      value: this.calculatorLambda.functionArn,
      description: 'ARN of the Calculator Lambda function',
      exportName: `${this.stackName}-CalculatorLambdaArn`,
    });
  }
}
