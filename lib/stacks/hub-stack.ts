/**
 * Hub Stack
 *
 * Creates the central hub account infrastructure for multi-account VPC Flow Logs
 * data transfer calculation. This stack receives flow logs from spoke accounts
 * via Kinesis stream and processes them using a Calculator Lambda.
 *
 * Based on CloudFormation template: data-transfer-calculator.yml
 *
 * Architecture:
 * - DynamoDB table for AZ mapping (shared with spoke accounts via cross-account role)
 * - Kinesis stream to receive flow logs from spoke accounts
 * - CloudWatch Logs destination for cross-account log delivery
 * - Calculator Lambda triggered by Kinesis to process flow logs
 */

import { Stack, StackProps, CfnOutput, Duration, Aws } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { KinesisEventSource, StartingPosition } from 'aws-cdk-lib/aws-lambda-event-sources';

import { AzMappingTableConstruct } from '../constructs';

/**
 * Props for HubStack
 */
export interface HubStackProps extends StackProps {
  /**
   * S3 bucket containing Lambda code (kept for compatibility).
   * Note: In CDK, we use Code.fromAsset instead, but this prop allows
   * maintaining compatibility with existing deployment scripts.
   */
  readonly lambdaCodeBucket: string;

  /**
   * Array of spoke account IDs that can send logs to this hub.
   * These accounts will be granted access to the CloudWatch Logs destination
   * and the DynamoDB access role.
   */
  readonly spokeAccountIds: string[];
}

/**
 * Stack that creates the hub account infrastructure for multi-account deployment.
 *
 * Resources created:
 * - AZ mapping DynamoDB table with cross-account access role
 * - Kinesis stream for receiving flow logs
 * - CloudWatch Logs destination for spoke account log delivery
 * - Calculator Lambda for processing flow logs from Kinesis
 */
export class HubStack extends Stack {
  /**
   * ARN of the CloudWatch Logs destination for spoke accounts
   */
  public readonly destinationArn: string;

  /**
   * ARN of the DynamoDB access role for spoke accounts
   */
  public readonly ddbRoleArn: string;

  /**
   * The AZ mapping DynamoDB table
   */
  public readonly azMappingTable: AzMappingTableConstruct;

  /**
   * The Kinesis stream receiving flow logs
   */
  public readonly kinesisStream: kinesis.Stream;

  constructor(scope: Construct, id: string, props: HubStackProps) {
    super(scope, id, props);

    const { spokeAccountIds } = props;

    // Create the AZ mapping DynamoDB table
    // Note: We create a separate cross-account role for multi-account access
    this.azMappingTable = new AzMappingTableConstruct(this, 'AzMappingTable', {
      tableName: 'AZsMapping',
    });

    // Create DDB role for cross-account access from spoke accounts
    // This role can be assumed by any of the spoke accounts
    const ddbRole = new iam.Role(this, 'DDBRole', {
      assumedBy: new iam.CompositePrincipal(
        ...spokeAccountIds.map((accountId) => new iam.AccountPrincipal(accountId))
      ),
      path: '/',
      description: 'Role for spoke accounts to access AZ mapping DynamoDB table',
    });

    // Grant DynamoDB access scoped to AZ mapping table only
    ddbRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:PutItem',
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:BatchWriteItem',
        ],
        resources: [this.azMappingTable.table.tableArn],
      })
    );

    this.ddbRoleArn = ddbRole.roleArn;

    // Create Kinesis stream to receive flow logs from spoke accounts
    // Matching rReceiverKinesis from CloudFormation
    this.kinesisStream = new kinesis.Stream(this, 'RecipientStream', {
      streamName: 'RecipientStream',
      shardCount: 1,
    });

    // Create IAM role for CloudWatch Logs to write to Kinesis
    // Matching rCWLtoKinesisRole from CloudFormation
    const cwlToKinesisRole = new iam.Role(this, 'CWLtoKinesisRole', {
      assumedBy: new iam.ServicePrincipal(`logs.${Aws.REGION}.amazonaws.com`),
      path: '/',
      description: 'Role for CloudWatch Logs to write to Kinesis stream',
    });

    // Grant Kinesis PutRecord permission
    cwlToKinesisRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kinesis:PutRecord'],
        resources: [this.kinesisStream.streamArn],
      })
    );

    // Create CloudWatch Logs destination for spoke accounts
    // This allows spoke accounts to send their VPC flow logs to this hub
    // Matching rVpcFlowLogDst from CloudFormation
    const destinationPolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            AWS: spokeAccountIds,
          },
          Action: 'logs:PutSubscriptionFilter',
          Resource: `arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:destination:VPCFlowLogDst`,
        },
      ],
    });

    const vpcFlowLogDestination = new logs.CfnDestination(this, 'VPCFlowLogDst', {
      destinationName: 'VPCFlowLogDst',
      roleArn: cwlToKinesisRole.roleArn,
      targetArn: this.kinesisStream.streamArn,
      destinationPolicy,
    });

    this.destinationArn = vpcFlowLogDestination.attrArn;

    // Create VPC Flow Log publish role (for local VPCs if needed)
    // Matching rVpcFlogLogPublishRole from CloudFormation
    const vpcFlowLogPublishRole = new iam.Role(this, 'VpcFlowLogPublishRole', {
      assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com'),
      path: '/',
      description: 'Role for VPC Flow Logs to publish to CloudWatch Logs',
    });

    vpcFlowLogPublishRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'logs:DescribeLogGroups',
          'logs:DescribeLogStreams',
        ],
        resources: ['*'],
      })
    );

    // Create Calculator Lambda execution role
    // Matching rCalculatorLambdaExecRole from CloudFormation
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

    // Add scoped permissions for specific resources
    calculatorLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Scan', 'dynamodb:GetItem', 'dynamodb:Query'],
        resources: [this.azMappingTable.table.tableArn],
      })
    );

    calculatorLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ec2:DescribeNetworkInterfaces'],
        resources: ['*'], // EC2 describe actions don't support resource-level permissions
      })
    );

    calculatorLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'kinesis:GetRecords',
          'kinesis:GetShardIterator',
          'kinesis:DescribeStream',
          'kinesis:ListShards',
        ],
        resources: [this.kinesisStream.streamArn],
      })
    );

    // Add STS AssumeRole permission for cross-account access
    calculatorLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:Assume*'],
        resources: ['*'],
      })
    );

    // Create Calculator Lambda function
    // Note: Using Code.fromAsset instead of S3 bucket reference
    const calculatorLambda = new lambda.Function(this, 'CalculatorLambda', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset('lambda/calculator'),
      role: calculatorLambdaRole,
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: {
        CURRENT_ACCOUNT: Aws.ACCOUNT_ID,
        SPOKE_ACCOUNT_IDS: spokeAccountIds.join(','),
        DDB_NAME: this.azMappingTable.tableName,
      },
      description: 'Processes VPC flow logs from Kinesis and calculates cross-AZ data transfer',
    });

    // Add Kinesis event source to trigger Calculator Lambda
    // Matching rCalculatorLambdaEventSource from CloudFormation
    calculatorLambda.addEventSource(
      new KinesisEventSource(this.kinesisStream, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 1,
      })
    );

    // Stack outputs
    new CfnOutput(this, 'CWDestinationArn', {
      value: this.destinationArn,
      description: 'CloudWatch Logs destination ARN for spoke accounts',
      exportName: `${this.stackName}-DestinationArn`,
    });

    new CfnOutput(this, 'DDBRoleArn', {
      value: this.ddbRoleArn,
      description: 'DynamoDB access role ARN for spoke accounts',
      exportName: `${this.stackName}-DDBRoleArn`,
    });
  }
}
