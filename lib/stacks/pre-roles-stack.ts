/**
 * Pre-Roles Stack
 *
 * Creates the pre-requisite IAM role for spoke accounts in a multi-account
 * deployment. This role allows the hub account to perform cross-account
 * operations on the spoke account.
 *
 * Based on CloudFormation template: pre-roles.yml
 *
 * Usage:
 * Deploy this stack to each spoke account before deploying the SpokeStack.
 * Provide the hub account ID as the centralAccountId prop.
 */

import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * Props for PreRolesStack
 */
export interface PreRolesStackProps extends StackProps {
  /**
   * The hub account ID that can assume this role.
   * This is the central account that orchestrates multi-account deployments.
   */
  readonly centralAccountId: string;
}

/**
 * Stack that creates the DtazExecRole IAM role for cross-account access.
 *
 * This role is created in spoke accounts and allows the hub account to
 * perform administrative operations. It should be deployed before the
 * main spoke infrastructure.
 */
export class PreRolesStack extends Stack {
  /**
   * The ARN of the execution role created for cross-account access
   */
  public readonly roleArn: string;

  /**
   * The IAM role for cross-account execution
   */
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: PreRolesStackProps) {
    super(scope, id, props);

    // Create the DtazExecRole that allows the hub account to assume it
    // This mirrors the rSpokeAccountExecRole from pre-roles.yml
    this.role = new iam.Role(this, 'DtazExecRole', {
      roleName: 'DtazExecRole',
      assumedBy: new iam.AccountPrincipal(props.centralAccountId),
      path: '/',
      description: 'Cross-account execution role for VPC Flow Logs data transfer calculator',
    });

    // Add admin-level policy (matching the CloudFormation template)
    // Note: In production, consider using more restrictive permissions
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['*'],
        resources: ['*'],
      })
    );

    this.roleArn = this.role.roleArn;

    // Output the role ARN for reference by other stacks
    new CfnOutput(this, 'SpokeAccountExecRoleArn', {
      value: this.roleArn,
      description: 'ARN of the DtazExecRole for cross-account access',
      exportName: `${this.stackName}-ExecRoleArn`,
    });
  }
}
