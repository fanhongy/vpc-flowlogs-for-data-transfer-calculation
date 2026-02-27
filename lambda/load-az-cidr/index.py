"""
Load AZ CIDR Custom Resource Lambda Function

This Lambda function is a CloudFormation custom resource that loads
all existing subnet-to-availability-zone mappings into DynamoDB.
It is called during initial stack deployment to populate the AZ
mapping table with current subnet information.

Handler: lambda_handler
Runtime: Python 3.11+
"""
from __future__ import annotations

import json
from typing import Any, Literal, TypedDict

import boto3
import botocore.exceptions
import urllib3

# Response status constants
SUCCESS: Literal["SUCCESS"] = "SUCCESS"
FAILED: Literal["FAILED"] = "FAILED"

# HTTP client for CloudFormation callback
http = urllib3.PoolManager()

# DynamoDB table name
DDB_TABLE_NAME = "AZsMapping"


class SubnetAZInfo(TypedDict):
    """Type definition for subnet availability zone information."""
    AvailabilityZoneId: str
    CidrBlock: str
    SubnetId: str


def send_cfn_response(
    event: dict[str, Any],
    context: Any,
    response_status: str,
    response_data: dict[str, Any],
    reason: str | None = None,
    physical_resource_id: str | None = None,
    no_echo: bool = False
) -> None:
    """
    Send response back to CloudFormation for custom resource.
    
    Args:
        event: The CloudFormation custom resource event.
        context: The Lambda context object.
        response_status: SUCCESS or FAILED.
        response_data: Data to return to CloudFormation.
        reason: Optional reason for the response.
        physical_resource_id: Optional physical resource ID.
        no_echo: Whether to mask the response in CloudFormation.
    """
    response_url = event['ResponseURL']
    print(f"Response URL: {response_url}")
    
    log_stream_name = getattr(context, 'log_stream_name', 'unknown')
    
    response_body = {
        'Status': response_status,
        'Reason': reason or f"See CloudWatch Log Stream: {log_stream_name}",
        'PhysicalResourceId': physical_resource_id or log_stream_name,
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'NoEcho': no_echo,
        'Data': response_data
    }
    
    json_response_body = json.dumps(response_body)
    print(f"Response body: {json_response_body}")
    
    headers = {
        'content-type': '',
        'content-length': str(len(json_response_body))
    }
    
    try:
        response = http.request(
            'PUT',
            response_url,
            headers=headers,
            body=json_response_body
        )
        print(f"Status code: {response.status}")
    except Exception as e:
        print(f"Failed to send response to CloudFormation: {e}")


def get_all_subnet_az_info() -> list[SubnetAZInfo]:
    """
    Retrieve all subnets and their availability zone information.
    
    Returns:
        List of subnet AZ information dictionaries.
        
    Raises:
        botocore.exceptions.ClientError: If describe_subnets fails.
    """
    ec2 = boto3.client('ec2')
    subnet_az_list: list[SubnetAZInfo] = []
    
    paginator = ec2.get_paginator('describe_subnets')
    
    for page in paginator.paginate():
        for subnet in page.get('Subnets', []):
            subnet_info: SubnetAZInfo = {
                'AvailabilityZoneId': subnet['AvailabilityZoneId'],
                'CidrBlock': subnet['CidrBlock'],
                'SubnetId': subnet['SubnetId']
            }
            subnet_az_list.append(subnet_info)
            print(f"Found subnet: {subnet_info}")
    
    return subnet_az_list


def get_dynamodb_table(central_account_role: str | None) -> Any:
    """
    Get DynamoDB table resource, optionally using cross-account role.
    
    Args:
        central_account_role: IAM role ARN for cross-account access,
            or 'NoValue' for same-account access.
            
    Returns:
        DynamoDB Table resource.
        
    Raises:
        botocore.exceptions.ClientError: If role assumption fails.
    """
    if central_account_role is None or central_account_role == 'NoValue':
        # Same account - use default credentials
        dynamodb = boto3.resource('dynamodb')
        return dynamodb.Table(DDB_TABLE_NAME)
    
    # Cross-account - assume role
    sts_client = boto3.client('sts')
    
    assumed_role = sts_client.assume_role(
        RoleArn=central_account_role,
        RoleSessionName="cross_acct_lambda"
    )
    
    credentials = assumed_role['Credentials']
    
    dynamodb = boto3.resource(
        'dynamodb',
        aws_access_key_id=credentials['AccessKeyId'],
        aws_secret_access_key=credentials['SecretAccessKey'],
        aws_session_token=credentials['SessionToken']
    )
    
    return dynamodb.Table(DDB_TABLE_NAME)


def load_subnets_to_dynamodb(
    subnets: list[SubnetAZInfo],
    central_account_role: str | None
) -> int:
    """
    Load subnet-to-AZ mappings into DynamoDB table.
    
    Args:
        subnets: List of subnet AZ information to load.
        central_account_role: IAM role ARN for cross-account access.
        
    Returns:
        Number of items successfully loaded.
        
    Raises:
        botocore.exceptions.ClientError: If DynamoDB operations fail.
    """
    table = get_dynamodb_table(central_account_role)
    loaded_count = 0
    
    for subnet in subnets:
        print(f"Adding record: AZ={subnet['AvailabilityZoneId']}, "
              f"CIDR={subnet['CidrBlock']}, SubnetId={subnet['SubnetId']}")
        
        try:
            table.put_item(Item=subnet)
            loaded_count += 1
        except botocore.exceptions.ClientError as e:
            print(f"Error adding subnet {subnet['SubnetId']}: {e}")
            raise
    
    return loaded_count


def lambda_handler(event: dict[str, Any], context: Any) -> None:
    """
    CloudFormation custom resource handler for loading AZ CIDR data.
    
    Handles Create requests from CloudFormation to populate the
    DynamoDB table with current subnet-to-AZ mappings.
    
    Args:
        event: The CloudFormation custom resource event.
        context: The Lambda context object.
    """
    response_data: dict[str, Any] = {}
    
    print(f"REQUEST BODY: {json.dumps(event)}")
    
    try:
        # Extract resource properties
        resource_props = event.get('ResourceProperties', {})
        central_account_role: str = resource_props.get('CentralAccountRoles', 'NoValue')
        
        # Get all subnet AZ information
        subnet_az_list = get_all_subnet_az_info()
        print(f"Found {len(subnet_az_list)} subnets")
        
        # Load subnets into DynamoDB
        loaded_count = load_subnets_to_dynamodb(subnet_az_list, central_account_role)
        
        response_data['LoadedCount'] = loaded_count
        response_status = SUCCESS
        print(f"Successfully loaded {loaded_count} subnet records")
        
    except Exception as e:
        print(f"Error in lambda_handler: {e}")
        response_status = FAILED
        response_data['Error'] = str(e)
    
    send_cfn_response(event, context, response_status, response_data)
