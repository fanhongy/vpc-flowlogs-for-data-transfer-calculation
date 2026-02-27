"""
Update DynamoDB Table Lambda Function

This Lambda function is triggered by CloudTrail events (via CloudWatch Logs)
when new subnets are created. It automatically updates the DynamoDB
AZ mapping table with the new subnet information.

Handler: lambda_handler
Runtime: Python 3.11+
"""
from __future__ import annotations

import base64
import gzip
import json
import os
from typing import Any, TypedDict

import boto3
import botocore.exceptions

# Environment variable for cross-account role
CENTRAL_ACCOUNT_ROLE: str = os.environ.get("CENTRAL_ACCOUNT_ROLE", "NoValue")

# DynamoDB table name
DDB_TABLE_NAME = "AZsMapping"


class SubnetAZInfo(TypedDict):
    """Type definition for subnet availability zone information."""
    AvailabilityZoneId: str
    CidrBlock: str
    SubnetId: str


def get_dynamodb_table(central_account_role: str) -> Any:
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
    if central_account_role == 'NoValue':
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


def add_subnet_to_dynamodb(
    subnet_info: SubnetAZInfo,
    central_account_role: str
) -> None:
    """
    Add a subnet record to the DynamoDB table.
    
    Args:
        subnet_info: The subnet information to add.
        central_account_role: IAM role ARN for cross-account access.
        
    Raises:
        botocore.exceptions.ClientError: If DynamoDB put fails.
    """
    table = get_dynamodb_table(central_account_role)
    
    print(f"Adding subnet to DynamoDB: {subnet_info}")
    table.put_item(Item=subnet_info)
    print(f"Successfully added subnet {subnet_info['SubnetId']}")


def extract_subnet_info_from_cloudtrail(payload: dict[str, Any]) -> SubnetAZInfo:
    """
    Extract subnet information from CloudTrail CreateSubnet event.
    
    Args:
        payload: The decoded CloudWatch Logs payload.
        
    Returns:
        Subnet AZ information extracted from the event.
        
    Raises:
        KeyError: If expected fields are missing from the event.
    """
    log_events = payload['logEvents']
    
    # Parse the CloudTrail event message
    event_message = json.loads(log_events[0]['message'])
    
    # Extract subnet details from the response elements
    subnet_response = event_message['responseElements']['subnet']
    
    subnet_info: SubnetAZInfo = {
        'AvailabilityZoneId': subnet_response['availabilityZoneId'],
        'CidrBlock': subnet_response['cidrBlock'],
        'SubnetId': subnet_response['subnetId']
    }
    
    return subnet_info


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Lambda handler for CloudTrail CreateSubnet events.
    
    Processes CloudWatch Logs events containing CloudTrail records
    for subnet creation. Extracts the new subnet information and
    updates the DynamoDB AZ mapping table.
    
    Args:
        event: The Lambda event payload (CloudWatch Logs subscription).
        context: The Lambda context object.
        
    Returns:
        Response indicating success or failure.
    """
    print(f"Logging Event: {json.dumps(event)}")
    
    try:
        # Decode and decompress the CloudWatch Logs data
        awslogs_data = event['awslogs']['data']
        print(f"Received CloudWatch Logs data")
        
        compressed_payload = base64.b64decode(awslogs_data)
        uncompressed_payload = gzip.decompress(compressed_payload)
        payload = json.loads(uncompressed_payload)
        
        print(f"Decoded payload log group: {payload.get('logGroup', 'unknown')}")
        
        # Extract subnet information from CloudTrail event
        subnet_info = extract_subnet_info_from_cloudtrail(payload)
        print(f"Extracted subnet info: {subnet_info}")
        
        # Add subnet to DynamoDB
        add_subnet_to_dynamodb(subnet_info, CENTRAL_ACCOUNT_ROLE)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Successfully added subnet to DynamoDB',
                'subnetId': subnet_info['SubnetId']
            })
        }
        
    except KeyError as e:
        print(f"Missing required field in event: {e}")
        return {
            'statusCode': 400,
            'body': json.dumps({
                'error': f'Missing required field: {e}'
            })
        }
        
    except json.JSONDecodeError as e:
        print(f"Failed to parse JSON: {e}")
        return {
            'statusCode': 400,
            'body': json.dumps({
                'error': f'Invalid JSON in event: {e}'
            })
        }
        
    except botocore.exceptions.ClientError as e:
        print(f"AWS API error: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': f'AWS API error: {e}'
            })
        }
        
    except Exception as e:
        print(f"Unexpected error: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': f'Unexpected error: {e}'
            })
        }
