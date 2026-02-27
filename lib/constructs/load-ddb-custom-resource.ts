/**
 * Load DynamoDB Custom Resource Construct
 *
 * Custom resource that loads initial subnet/AZ data into DynamoDB on stack creation.
 * This populates the AZ mapping table with existing subnet information from the
 * AWS account, enabling the data transfer calculator to map IP addresses to
 * availability zones from the start.
 *
 * Resources created:
 * - Lambda function for custom resource handling (Python 3.11)
 * - IAM role for Lambda execution with DynamoDB, EC2, S3, and logs permissions
 * - Custom resource Provider
 * - Custom resource that triggers on stack creation/update
 *
 * Based on CloudFormation resources from single-account-deployment.yml:
 * - rInitDDBLambdaExecRole
 * - rLoadDDBLambda
 * - rCustomResourceUpdateDDB
 */

import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Duration, CustomResource } from 'aws-cdk-lib';

/**
 * Props for LoadDdbCustomResourceConstruct
 */
export interface LoadDdbCustomResourceProps {
  /**
   * Optional IAM role ARN for cross-account DynamoDB access.
   * When specified, the Lambda will assume this role to write to a
   * DynamoDB table in a central/hub account.
   */
  readonly centralAccountRoleArn?: string;
}

/**
 * Construct that creates a custom resource to load initial subnet/AZ data into DynamoDB.
 *
 * This custom resource runs on stack creation to populate the DynamoDB table
 * with all existing subnet-to-AZ mappings in the account. This ensures the
 * data transfer calculator has complete AZ mapping information from day one.
 *
 * For multi-account deployments, the centralAccountRoleArn prop enables the
 * Lambda to assume a role in the hub account to access the central DynamoDB table.
 */
export class LoadDdbCustomResourceConstruct extends Construct {
  /**
   * The Lambda function used by the custom resource
   */
  public readonly lambda: lambda.Function;

  /**
   * The IAM role for the Lambda function
   */
  public readonly lambdaRole: iam.Role;

  /**
   * The custom resource
   */
  public readonly customResource: CustomResource;

  constructor(scope: Construct, id: string, props: LoadDdbCustomResourceProps = {}) {
    super(scope, id);

    const { centralAccountRoleArn } = props;

    // Create IAM role for the custom resource Lambda
    this.lambdaRole = new iam.Role(this, 'LambdaExecRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for Load DynamoDB custom resource Lambda',
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

    // Add EC2 permissions to describe subnets and availability zones
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ec2:*'],
        resources: ['*'],
      })
    );

    // Add S3 permissions (used for some operations)
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

    // Create the custom resource Lambda function
    this.lambda = new lambda.Function(this, 'LoadDDBLambda', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset('lambda/load-az-cidr'),
      role: this.lambdaRole,
      timeout: Duration.seconds(150),
      description: 'Custom resource Lambda to load initial subnet/AZ data to DynamoDB',
    });

    // Create the custom resource provider
    const provider = new cr.Provider(this, 'LoadDDBProvider', {
      onEventHandler: this.lambda,
    });

    // Build the custom resource properties
    const customResourceProps: Record<string, unknown> = {};
    if (centralAccountRoleArn) {
      customResourceProps['CentralAccountRoles'] = centralAccountRoleArn;
    }

    // Create the custom resource to trigger initial data load
    this.customResource = new CustomResource(this, 'LoadDDBCustomResource', {
      serviceToken: provider.serviceToken,
      properties: customResourceProps,
    });
  }
}
