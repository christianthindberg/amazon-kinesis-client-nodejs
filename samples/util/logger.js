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

var log4js = require('log4js');
const process = require("process");

function logger() {
  var logDir = process.env.NODE_LOG_DIR !== undefined ? process.env.NODE_LOG_DIR : '.';

  var config = {
    appenders: [
      {
        type:       "file",
        filename:   logDir + "/" + "consumer.log", //logDirSub + "application.log",
        maxLogSize: 102400,
        backups:    3,
        pattern:    "-yyyy-MM-dd",
        layout:     {
          type:    "pattern",
          pattern: "%d (PID: %x{pid}) %p %c - %m",
          tokens:  {
            pid: function () {
              return process.pid;
            }
          } // tokens
        } // layout
      }  //, // appender
      //{
      //  type: "console" //-- should not really do this as stdin, stdout, stderr is reservered for multilangdeamon to childprocess communication
      //}                 // but convenient sometimes for testing locally...
    ]
  };
  /*
   , // appender
   {
   type: "console" -- should not really do this as stdin, stdout, stderr is reservered for multilangdeamon to childprocess communication
   }

  var config = {
    "appenders": [
      {
        "type": "file",
        "filename": logDir + "/" + "application.log",
        "pattern": "-yyyy-MM-dd",
        "layout": {
          "type": "pattern",
          "pattern": "%d (PID: %x{pid}) %p %c - %m",
          "tokens": {
            "pid" : function() { return process.pid; }
          }
        }
      }
    ]
  };
  */

  log4js.configure(config, {});

  return {
    getLogger: function(category) {
      return log4js.getLogger(category);
    }
  };
}

module.exports = logger;
