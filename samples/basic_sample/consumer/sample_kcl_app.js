/***
Copyright 2015 Amazon.com, Inc. or its affiliates. All Rights Reserved.

Licensed under the Amazon Software License (the "License").
You may not use this file except in compliance with the License.
A copy of the License is located at

http://aws.amazon.com/asl/

or in the "license" file accompanying this file. This file is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
express or implied. See the License for the specific language governing
permissions and limitations under the License.
***/

'use strict';


var fs = require('fs');
var path = require('path');
var util = require('util');
var kcl = require('../../..');
var logger = require('../../util/logger');


// CT own additions
var redis = require("redis");
var os = require("os");

/**
 * A simple implementation for the record processor (consumer) that simply writes the data to a log file.
 *
 * Be careful not to use the 'stderr'/'stdout'/'console' as log destination since it is used to communicate with the
 * {https://github.com/awslabs/amazon-kinesis-client/blob/master/src/main/java/com/amazonaws/services/kinesis/multilang/package-info.java MultiLangDaemon}.
 */

function recordProcessor() {
  var log = logger().getLogger('recordProcessor');
  var shardId;
  var redisClient;

  return {

    initialize: function(initializeInput, completeCallback) {
      shardId = initializeInput.shardId;

      // CT connect to local Redis or AWS Redis
      if (os.platform() === "darwin") { // running locally on Mac, connect to local Redis
        redisClient = redis.createClient();
        //log.info ("redis test in producer: " + util.inspect(redisClient));
      } else { // on AWS
        redisClient = redis.createClient(6379, "web-app-redis.bbfmv1.0001.use1.cache.amazonaws.com");
        //log.info ("redis test in producer: " + util.inspect(redisClient));
      }

      completeCallback();
    },

    processRecords: function(processRecordsInput, completeCallback) {
      if (!processRecordsInput || !processRecordsInput.records) {
        completeCallback();
        return;
      }
      var records = processRecordsInput.records;
      var record, data, sequenceNumber, partitionKey, obj;
      for (var i = 0 ; i < records.length ; ++i) {
        record = records[i];
        sequenceNumber = record.sequenceNumber;
        partitionKey = record.partitionKey;
        data = new Buffer(record.data, 'base64'); //.toString();
        //log.info("data: " + data);
        try {
          obj = JSON.parse(data);
        } catch (e) {
          log.info("Error - Invalid JSON - " + e.message + " " + e.name + ": " + data);
          obj = {topic: "Error"};
        }

        if (!obj["topic"] || obj["topic"] == null) {
          obj["topic"] = "Error";
          log.info("Error - No topic: " + JSON.stringify(obj));
        }
        //log.info("object: " + JSON.stringify(obj));
        //log.info("data.topic:" + obj["topic"]);
        //log.info("frequency: " + obj["frequency"]);
        //log.info("values: " + obj["values"]);
        redisClient.publish (obj["topic"], data);
        // Todo: consider adding all partitionKeys to a redis-set, so they can be fetched by consumers. May be useful is partitionkey equal train-ID, ... other ID of the producder
        // Todo: consider also to do redisClient.publish(partitionkey, data) so that consumers can subscribe to data from individual producers
        //log.info(util.format('ShardID: %s, Record: %s, SeqenceNumber: %s, PartitionKey:%s', shardId, data, sequenceNumber, partitionKey));
      }
      if (!sequenceNumber) {
        completeCallback();
        return;
      }
      // If checkpointing, completeCallback should only be called once checkpoint is complete.
      processRecordsInput.checkpointer.checkpoint(sequenceNumber, function(err, sequenceNumber) {
        //log.info(util.format('Checkpoint successful. ShardID: %s, SeqenceNumber: %s', shardId, sequenceNumber));
        completeCallback();
      });
    },

    shutdown: function(shutdownInput, completeCallback) {
      redisClient.end();
      // Checkpoint should only be performed when shutdown reason is TERMINATE.
      if (shutdownInput.reason !== 'TERMINATE') {
        completeCallback();
        return;
      }
      // Whenever checkpointing, completeCallback should only be invoked once checkpoint is complete.
      shutdownInput.checkpointer.checkpoint(function(err) {
        completeCallback();
      });
    }
  };
}

kcl(recordProcessor()).run();
