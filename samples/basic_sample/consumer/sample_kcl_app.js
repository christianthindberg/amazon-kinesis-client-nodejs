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

const redis = require("redis");
let KafkaRest = require("kafka-rest");
let kafka = new KafkaRest({"url": "http://ec2-52-211-70-204.eu-west-1.compute.amazonaws.com:8082"});

const os = require("os");
const process = require("process");

// It is possible to define the topic we use to publish to redis from an environment variable.
// If environment variable is not defined we use the name of the Kinesis stream defined in sample.properties as the topic
let redisTopic = null;

// If the environment variable rutertopic is defined we try to send the data also to Ruter Kafka
let Rutertopic = null;

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

      redisTopic = process.env.REDIS_TOPIC;
      Rutertopic = process.env.RUTER_TOPIC;

      log.info("recordProcessor:initialize. Environement variable REDIS_TOPIC = " + redisTopic + " space");
      log.info("recordProcessor:initialize. Environement variable RUTER_TOPIC = " + Rutertopic + " space");

      if (Rutertopic) { // test connection with Ruter Kafka, see if we manage to list topics
        kafka.topics.list(function (err, topics) {
          if (err) {
            log.error ("kafka.topics.list. Unable to list topics: " + err);
          }
          else {
            for (let i=0; i < topics.length; i++) {
              log.info(topics[i].toString());
            }
          }
        });
      }

      if (!redisTopic) { // Read name of Kinesis stream from sample properties and use this as topic
        let fileContents = fs.readFileSync(path.join(__dirname, "sample.properties"));
        let fileLines = fileContents.toString().split('\n');

        //log.debug("fileContents: " + fileContents);
        log.debug("fileLines.length: " + fileLines.length);

        for (let i=0; i<fileLines.length; i++) {
          const items = fileLines[i].toString().split(" ");
          if (items[0].trim().toLowerCase() === "streamname" && items[1].trim().toLowerCase() === "=") {
            redisTopic = items[2];
            break;
          }
        }
      }

      if (!redisTopic) {
        log.error("recordProcessor:initialize. redisTopic not found. Missing environment variable and could not read Kinesis streamName from sample.properties");
        redisTopic = "Error";
        // todo: find out the proper way to abort the initialization process. Simply returning without calling  completeCallback does not do the trick...
      }

      // Connect to local Redis or AWS Redis
      if (os.platform() === "darwin") { // running locally on Mac, connect to local Redis
        redisClient = redis.createClient();
        //log.info ("redis test in producer: " + util.inspect(redisClient));
      } else { // on AWS
        redisClient = redis.createClient(6379, "oslometro-redis-001.ezuesa.0001.euw1.cache.amazonaws.com");
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
        //log.info("inspect: " + util.inspect(processRecordsInput));
        record = records[i];
        sequenceNumber = record.sequenceNumber;
        partitionKey = record.partitionKey;
        data = new Buffer(record.data, 'base64'); //.toString();
        redisClient.publish (redisTopic, data);
        log.info("published data to redis: " + redisTopic);
        if (Rutertopic) {
          log.info("Rutertopic: " + Rutertopic);
          kafka.topic(Rutertopic).partition(0).produce([data], function (err, response) {
            if (err) {
              log.error("processRecords. Writing to Ruter Kafka failed. Environment variable RUTER_TOPIC: " + Rutertopic + " Error: " + err);
            }
            else {
              log.info("processRecords. Kafka response: " + response);
            }
          });
        }
        //log.info("processRecords. data: " + data);
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
      log.info("shutdown: " + shutdownInput.reason);
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
