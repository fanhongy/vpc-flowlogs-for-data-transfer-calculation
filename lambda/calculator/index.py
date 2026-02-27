"""
VPC Flow Logs Calculator Lambda Function

This Lambda function processes VPC flow logs to calculate data transfer
between availability zones. It identifies cross-AZ traffic and outputs
the transfer details for cost analysis.

Handler: lambda_handler
Runtime: Python 3.11+
"""
from __future__ import annotations

import base64
import gzip
import json
import math
import os
from typing import Any, TypedDict

import boto3
import botocore.exceptions
import ipaddress

# Environment variables
SPOKE_ACCOUNT_IDS: str = os.environ.get("SPOKE_ACCOUNT_IDS", "NoValue")
CURRENT_ACCOUNT: str = os.environ.get("CURRENT_ACCOUNT", "")
DDB_NAME: str = os.environ.get("DDB_NAME", "AZsMapping")

# Constants
TEN_POWER_NINE: float = math.pow(10, 9)


class SubnetAZInfo(TypedDict):
    """Type definition for subnet availability zone information."""
    AvailabilityZoneId: str
    CidrBlock: str
    SubnetId: str


class FlowLogEntry(TypedDict):
    """Type definition for flow log entry."""
    srcaddr: str
    dstaddr: str
    bytes: str
    ENIId: str
    subnetid: str | None


def scan_dynamodb_table() -> list[SubnetAZInfo]:
    """
    Scan DynamoDB table to retrieve all subnet-to-AZ mappings.
    
    Returns:
        List of subnet AZ information dictionaries.
    """
    ddb = boto3.client('dynamodb')
    subnet_az_list: list[SubnetAZInfo] = []
    
    try:
        response = ddb.scan(TableName=DDB_NAME)
        
        for item in response.get('Items', []):
            subnet_info: SubnetAZInfo = {
                'AvailabilityZoneId': item['AvailabilityZoneId']['S'],
                'CidrBlock': item['CidrBlock']['S'],
                'SubnetId': item['SubnetId']['S']
            }
            subnet_az_list.append(subnet_info)
            
        # Handle pagination if table has more items
        while 'LastEvaluatedKey' in response:
            response = ddb.scan(
                TableName=DDB_NAME,
                ExclusiveStartKey=response['LastEvaluatedKey']
            )
            for item in response.get('Items', []):
                subnet_info = {
                    'AvailabilityZoneId': item['AvailabilityZoneId']['S'],
                    'CidrBlock': item['CidrBlock']['S'],
                    'SubnetId': item['SubnetId']['S']
                }
                subnet_az_list.append(subnet_info)
                
    except botocore.exceptions.ClientError as e:
        print(f"Error scanning DynamoDB table {DDB_NAME}: {e}")
        raise
        
    return subnet_az_list


def get_subnet_id_from_eni(eni: str, account_id: str | None = None) -> str | None:
    """
    Get the subnet ID associated with a network interface.
    
    Args:
        eni: The network interface ID.
        account_id: Optional account ID for cross-account access.
        
    Returns:
        The subnet ID if found, None otherwise.
    """
    if account_id is None:
        # Same account - use default credentials
        try:
            ec2 = boto3.client('ec2')
            response = ec2.describe_network_interfaces(
                NetworkInterfaceIds=[eni]
            )
            interfaces = response.get('NetworkInterfaces', [])
            if not interfaces:
                print(f"No network interface found for ENI {eni}")
                return None
            return interfaces[0]['SubnetId']
        except botocore.exceptions.ClientError as e:
            print(f"Error describing ENI {eni}: {e}")
            return None
    else:
        # Cross-account - assume role
        try:
            sts_client = boto3.client('sts')
            role_arn = f"arn:aws:iam::{account_id}:role/DtazExecRole"
            
            assumed_role = sts_client.assume_role(
                RoleArn=role_arn,
                RoleSessionName="cross_acct_lambda"
            )
            
            credentials = assumed_role['Credentials']
            
            ec2 = boto3.client(
                'ec2',
                aws_access_key_id=credentials['AccessKeyId'],
                aws_secret_access_key=credentials['SecretAccessKey'],
                aws_session_token=credentials['SessionToken']
            )
            
            response = ec2.describe_network_interfaces(
                NetworkInterfaceIds=[eni]
            )
            interfaces = response.get('NetworkInterfaces', [])
            if not interfaces:
                print(f"No network interface found for ENI {eni} in account {account_id}")
                return None
            return interfaces[0]['SubnetId']
            
        except botocore.exceptions.ClientError as e:
            print(f"Error describing ENI {eni} in account {account_id}: {e}")
            return None


def is_address_in_network(ip_address: str, subnet_cidr: str) -> bool:
    """
    Check if an IP address is within a subnet CIDR block.
    
    Args:
        ip_address: The IP address to check.
        subnet_cidr: The subnet CIDR block.
        
    Returns:
        True if the address is in the network, False otherwise.
    """
    try:
        ip_obj = ipaddress.ip_address(ip_address)
        network_obj = ipaddress.ip_network(subnet_cidr, strict=False)
        return ip_obj in network_obj
    except ValueError as e:
        print(f"Invalid IP or CIDR: {ip_address}, {subnet_cidr}: {e}")
        return False


def process_large_byte_count(byte_count: int, response: dict[str, Any]) -> None:
    """
    Handle byte counts larger than 10^9 by splitting into multiple events.
    
    CloudWatch Metrics Insights has limits on numeric values, so large
    byte transfers are split into multiple log entries.
    
    Args:
        byte_count: The total bytes transferred.
        response: The response dictionary to output.
    """
    if byte_count > TEN_POWER_NINE:
        num_chunks = math.ceil(byte_count / TEN_POWER_NINE)
        
        for i in range(num_chunks):
            if i < num_chunks - 1:
                # Full chunk
                response['event']['bytes'] = int(TEN_POWER_NINE)
            else:
                # Last chunk with remaining bytes
                response['event']['bytes'] = byte_count - (i * int(TEN_POWER_NINE))
            print(json.dumps(response))
    else:
        response['event']['bytes'] = byte_count
        print(json.dumps(response))


def lambda_handler(event: dict[str, Any], context: Any) -> None:
    """
    Main Lambda handler for processing VPC flow logs.
    
    Processes flow log events to identify cross-AZ data transfers.
    Supports both single-account (CloudWatch Logs) and multi-account
    (Kinesis) event sources.
    
    Args:
        event: The Lambda event payload.
        context: The Lambda context object.
    """
    response: dict[str, Any] = {'event': {}}
    flow_log_entries: list[FlowLogEntry] = []
    
    # Determine event source and extract payload
    if SPOKE_ACCOUNT_IDS == "NoValue":
        # Single account: CloudWatch Logs subscription
        cw_data = event['awslogs']['data']
        compressed_payload = base64.b64decode(cw_data)
        uncompressed_payload = gzip.decompress(compressed_payload)
        payload = json.loads(uncompressed_payload)
        
        log_events = payload.get('logEvents', [])
        if not log_events:
            print("Warning: No log events found in payload")
            return
        
        eni_id = log_events[0]['extractedFields']['interface_id']
        subnet_id = get_subnet_id_from_eni(eni_id)
    else:
        # Multi-account: Kinesis stream
        cw_data = event['Records'][0]['kinesis']['data']
        compressed_payload = base64.b64decode(cw_data)
        uncompressed_payload = gzip.decompress(compressed_payload)
        payload = json.loads(uncompressed_payload)
        
        log_events = payload.get('logEvents', [])
        if not log_events:
            print("Warning: No log events found in payload")
            return
        
        eni_id = log_events[0]['extractedFields']['interface_id']
        owner_id = payload['owner']
        subnet_id = get_subnet_id_from_eni(eni_id, owner_id)
    
    # Extract flow log entries
    for log_event in log_events:
        extracted = log_event['extractedFields']
        entry: FlowLogEntry = {
            'srcaddr': extracted['srcaddr'],
            'dstaddr': extracted['dstaddr'],
            'bytes': extracted['bytes'],
            'ENIId': eni_id,
            'subnetid': subnet_id
        }
        flow_log_entries.append(entry)
    
    # Get subnet-to-AZ mapping from DynamoDB
    subnet_list = scan_dynamodb_table()
    
    # Process each flow log entry to identify cross-AZ transfers
    for entry in flow_log_entries:
        for src_az_info in subnet_list:
            # Check if source address is in this CIDR block
            if not is_address_in_network(entry['srcaddr'], src_az_info['CidrBlock']):
                continue
                
            # Validate subnet ID to avoid CIDR block overlap issues
            if entry['subnetid'] != src_az_info['SubnetId']:
                continue
                
            source_az_id = src_az_info['AvailabilityZoneId']
            
            # Find destination AZ
            for dest_az_info in subnet_list:
                if not is_address_in_network(entry['dstaddr'], dest_az_info['CidrBlock']):
                    continue
                    
                dest_az_id = dest_az_info['AvailabilityZoneId']
                
                # Only log cross-AZ transfers
                if source_az_id != dest_az_id:
                    response['event']['srIp'] = entry['srcaddr']
                    response['event']['destIp'] = entry['dstaddr']
                    response['event']['ENI'] = entry['ENIId']
                    
                    byte_count = int(entry['bytes'])
                    process_large_byte_count(byte_count, response)
