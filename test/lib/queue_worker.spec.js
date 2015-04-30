var _ = require('lodash'),
    Helpers = require('../helpers.js'),
    util = require('util'),
    chai = require('chai'),
    should = chai.should(),
    expect = chai.expect,
    sinon = require('sinon'),
    sinonChai = require('sinon-chai'),
    winston = require('winston'),
    chaiAsPromised = require('chai-as-promised');

winston.level = 'none';

chai.use(sinonChai);
chai.use(chaiAsPromised);

var th = new Helpers(),
    queueRef = th.testRef.child('queue');

describe('QueueWorker', function() {

  describe('initialize', function() {
    it('should not create a QueueWorker with no parameters', function() {
      expect(function() {
        new th.QueueWorker();
      }).to.throw('No queue reference provided.');
    });

    it('should not create a QueueWorker with only a queueRef', function() {
      expect(function() {
        new th.QueueWorker(queueRef);
      }).to.throw('Invalid process ID provided.');
    });

    it('should not create a QueueWorker with only a queueRef and a process ID', function() {
      expect(function() {
        new th.QueueWorker(queueRef, '0');
      }).to.throw('No processing function provided.');
    });

    it('should not create a QueueWorker with a queueRef, processId and an invalid processing function', function() {
      ['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }].forEach(function(nonFunctionObject) {
        expect(function() {
          new th.QueueWorker(queueRef, '0', nonFunctionObject);
        }).to.throw('No processing function provided.');
      });
    });

    it('should create a QueueWorker with a queueRef, processId and a processing function', function() {
      new th.QueueWorker(queueRef, '0', _.noop);
    });

    it('should not create a QueueWorker with a non-string processId specified', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        expect(function() {
          new th.QueueWorker(queueRef, nonStringObject, _.noop);
        }).to.throw('Invalid process ID provided.');
      });
    });
  });

  describe('#_getLogEntry', function() {
    var qw = new th.QueueWorker(queueRef, '0', _.noop);

    it('should construct a log entry given a string', function() {
      expect(qw._getLogEntry('informative message')).to.equal('QueueWorker 0 (' + qw.uuid + ') informative message');
    });

    it('should construct a log entry given a non-string', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        expect(qw._getLogEntry(nonStringObject)).to.equal('QueueWorker 0 (' + qw.uuid + ') ' + nonStringObject);
      });
    });
  });

  describe('#_resetItem', function() {
    var qw, testRef;

    afterEach(function(done) {
      qw.setJob();
      testRef.off();
      queueRef.set(null, done);
    });

    it('should reset a job that is currently in progress', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      testRef = queueRef.push({
        '_state': th.validBasicJobSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': 'someone',
        '_progress': 10
      }, function() {
        qw.currentItemRef = testRef;
        var initial = true;
        testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._resetItem(testRef);
          } else {
            try {
              var item = snapshot.val();
              expect(item).to.have.all.keys(['_state_changed']);
              expect(item['_state_changed']).to.be.closeTo(new Date().getTime(), 250);
              done();
            } catch (error) {
              done(error);
            }
          }
        });
      });
    });
  });

  describe('#_resolve', function() {
    var qw, testRef;

    afterEach(function(done) {
      qw.setJob();
      testRef.off();
      queueRef.set(null, done);
    });

    it('should resolve an item owned by the current worker and remove it when no finishedState is specified', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      testRef = queueRef.push({
        '_state': th.validBasicJobSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.uuid,
        '_progress': 0
      }, function() {
        qw.currentItemRef = testRef;
        var initial = true;
        testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._resolve();
          } else {
            try {
              expect(snapshot.val()).to.be.null;
              done();
            } catch (error) {
              done(error);
            }
          }
        });
      });
    });

    it('should resolve an item owned by the current worker and change the state when a finishedState is specified and no object passed', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validJobSpecWithFinishedState);
      testRef = queueRef.push({
        '_state': th.validJobSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.uuid,
        '_progress': 0
      }, function() {
        qw.currentItemRef = testRef;
        var initial = true;
        testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._resolve();
          } else {
            try {
              var item = snapshot.val();
              expect(item).to.have.all.keys(['_state', '_state_changed', '_progress']);
              expect(item['_progress']).to.equal(100);
              expect(item['_state']).to.equal(th.validJobSpecWithFinishedState.finishedState);
              expect(item['_state_changed']).to.be.closeTo(new Date().getTime(), 250);
              done();
            } catch (error) {
              done(error);
            }
          }
        });
      });
    });

    ['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], null, _.noop].forEach(function(nonPlainObject) {
      it('should resolve an item owned by the current worker and change the state when a finishedState is specified and an invalid object ' + nonPlainObject + ' passed', function(done) {
        qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
        qw.setJob(th.validJobSpecWithFinishedState);
        testRef = queueRef.push({
          '_state': th.validJobSpecWithFinishedState.inProgressState,
          '_state_changed': new Date().getTime(),
          '_owner': qw.uuid,
          '_progress': 0
        }, function() {
          qw.currentItemRef = testRef;
          var initial = true;
          testRef.on('value', function(snapshot) {
            if (initial) {
              initial = false;
              qw._resolve(nonPlainObject);
            } else {
              try {
                var item = snapshot.val();
                expect(item).to.have.all.keys(['_state', '_state_changed', '_progress']);
                expect(item['_progress']).to.equal(100);
                expect(item['_state']).to.equal(th.validJobSpecWithFinishedState.finishedState);
                expect(item['_state_changed']).to.be.closeTo(new Date().getTime(), 250);
                done();
              } catch (error) {
                done(error);
              }
            }
          });
        });
      });
    });

    it('should resolve an item owned by the current worker and change the state when a finishedState is specified and a plain object passed', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validJobSpecWithFinishedState);
      testRef = queueRef.push({
        '_state': th.validJobSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.uuid,
        '_progress': 0
      }, function() {
        qw.currentItemRef = testRef;
        var initial = true;
        testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._resolve({ foo: 'bar' });
          } else {
            try {
              var item = snapshot.val();
              expect(item).to.have.all.keys(['_state', '_state_changed', '_progress', 'foo']);
              expect(item['_progress']).to.equal(100);
              expect(item['_state']).to.equal(th.validJobSpecWithFinishedState.finishedState);
              expect(item['_state_changed']).to.be.closeTo(new Date().getTime(), 250);
              expect(item.foo).to.equal('bar');
              done();
            } catch (error) {
              done(error);
            }
          }
        });
      });
    });

    it('should not resolve an item that no longer exists', function(done) {
      testRef = queueRef.push();

      var CallbackQueueWorker = function() {
        th.QueueWorker.apply(this, arguments);
      };
      util.inherits(CallbackQueueWorker, th.QueueWorker);
      CallbackQueueWorker.prototype._setUpTimeouts = _.noop;
      CallbackQueueWorker.prototype._tryToProcess = function() {
        testRef.once('value', function(snapshot) {
          try {
            expect(snapshot.val()).to.be.null;
            done();
          } catch (error) {
            done(error);
          }
        });
      };
      qw = new CallbackQueueWorker(queueRef, '0', _.noop);

      qw.setJob(th.validJobSpecWithFinishedState);
      qw.currentItemRef = testRef;
      qw._resolve();
    });

    it('should not resolve an item if it is no longer owned by the current worker', function(done) {
      testRef = queueRef.push();
      var originalItem = {
        '_state': th.validJobSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': 'other_worker',
        '_progress': 0
      };

      var CallbackQueueWorker = function() {
        th.QueueWorker.apply(this, arguments);
      };
      util.inherits(CallbackQueueWorker, th.QueueWorker);
      CallbackQueueWorker.prototype._setUpTimeouts = _.noop;
      CallbackQueueWorker.prototype._tryToProcess = function() {
        testRef.once('value', function(snapshot) {
          try {
            expect(snapshot.val()).to.deep.equal(originalItem);
            done();
          } catch (error) {
            done(error);
          }
        });
      };

      qw = new CallbackQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validJobSpecWithFinishedState);
      testRef.set(originalItem, function() {
        qw.currentItemRef = testRef;
        qw._resolve();
      });
    });

    it('should not resolve an item if it is has already changed state', function(done) {
      testRef = queueRef.push();

      var CallbackQueueWorker = function() {
        th.QueueWorker.apply(this, arguments);
      };
      util.inherits(CallbackQueueWorker, th.QueueWorker);
      CallbackQueueWorker.prototype._setUpTimeouts = _.noop;
      var first = true;
      CallbackQueueWorker.prototype._tryToProcess = function() {
        if (first) {
          first = false;
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
              done();
            } catch (error) {
              done(error);
            }
          });
        }
      };

      qw = new CallbackQueueWorker(queueRef, '0', _.noop);
      var originalItem = {
        '_state': th.validJobSpecWithFinishedState.finishedState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.uuid,
        '_progress': 0
      };
      qw.setJob(th.validJobSpecWithFinishedState);
      testRef.set(originalItem, function() {
        qw.currentItemRef = testRef;
        qw._resolve();
      });
    });

    it('should not resolve an item if it is has no state', function(done) {
      testRef = queueRef.push();

      var CallbackQueueWorker = function() {
        th.QueueWorker.apply(this, arguments);
      };
      util.inherits(CallbackQueueWorker, th.QueueWorker);
      CallbackQueueWorker.prototype._setUpTimeouts = _.noop;
      var first = true;
      CallbackQueueWorker.prototype._tryToProcess = function() {
        if (first) {
          first = false;
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
              done();
            } catch (error) {
              done(error);
            }
          });
        }
      };

      qw = new CallbackQueueWorker(queueRef, '0', _.noop);
      var originalItem = {
        '_state_changed': new Date().getTime(),
        '_owner': qw.uuid,
        '_progress': 0
      };
      qw.setJob(th.validJobSpecWithFinishedState);
      testRef.set(originalItem, function() {
        qw.currentItemRef = testRef;
        qw._resolve();
      });
    });

    it('should not resolve an item if it is no longer being processed', function(done) {
      testRef = queueRef.push();

      var CallbackQueueWorker = function() {
        th.QueueWorker.apply(this, arguments);
      };
      util.inherits(CallbackQueueWorker, th.QueueWorker);
      CallbackQueueWorker.prototype._setUpTimeouts = _.noop;
      var first = true;
      CallbackQueueWorker.prototype._tryToProcess = function() {
        if (first) {
          first = false;
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
              done();
            } catch (error) {
              done(error);
            }
          });
        }
      };

      qw = new CallbackQueueWorker(queueRef, '0', _.noop);
      var originalItem = {
        '_state': th.validJobSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.uuid,
        '_progress': 0
      };
      qw.setJob(th.validJobSpecWithFinishedState);
      testRef.set(originalItem, function() {
        qw._resolve();
      });
    });
  });

  describe('#_reject', function() {
    var qw, testRef;

    afterEach(function(done) {
      qw.setJob();
      testRef.off();
      queueRef.set(null, done);
    });

    it('should reject an item owned by the current worker', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      testRef = queueRef.push({
        '_state': th.validBasicJobSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.uuid,
        '_progress': 0
      }, function() {
        qw.currentItemRef = testRef;
        var initial = true;
        testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._reject();
          } else {
            try {
              var item = snapshot.val();
              expect(item).to.have.all.keys(['_state', '_progress', '_state_changed', '_error_details']);
              expect(item['_state']).to.equal('error');
              expect(item['_state_changed']).to.be.closeTo(new Date().getTime(), 250);
              expect(item['_progress']).to.equal(0);
              expect(item['_error_details']).to.have.all.keys(['previousState']);
              expect(item['_error_details'].previousState).to.equal(th.validBasicJobSpec.inProgressState);
              done();
            } catch (error) {
              done(error);
            }
          }
        });
      });
    });

    [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
      it('should reject an item owned by the current worker and not add report the error if not a string: ' + nonStringObject, function(done) {
        qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
        qw.setJob(th.validBasicJobSpec);
        testRef = queueRef.push({
          '_state': th.validBasicJobSpec.inProgressState,
          '_state_changed': new Date().getTime(),
          '_owner': qw.uuid,
          '_progress': 0
        }, function() {
          qw.currentItemRef = testRef;
          var initial = true;
          testRef.on('value', function(snapshot) {
            if (initial) {
              initial = false;
              qw._reject(nonStringObject);
            } else {
              try {
                var item = snapshot.val();
                expect(item).to.have.all.keys(['_state', '_progress', '_state_changed', '_error_details']);
                expect(item['_state']).to.equal('error');
                expect(item['_state_changed']).to.be.closeTo(new Date().getTime(), 250);
                expect(item['_progress']).to.equal(0);
                expect(item['_error_details']).to.have.all.keys(['previousState']);
                expect(item['_error_details'].previousState).to.equal(th.validBasicJobSpec.inProgressState);
                done();
              } catch (error) {
                done(error);
              }
            }
          });
        });
      });
    });

    it('should reject an item owned by the current worker and append the error string to the _error_details', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      var error = 'My error message';
      qw.setJob(th.validBasicJobSpec);
      testRef = queueRef.push({
        '_state': th.validBasicJobSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.uuid,
        '_progress': 0
      }, function() {
        qw.currentItemRef = testRef;
        var initial = true;
        testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._reject(error);
          } else {
            try {
              var item = snapshot.val();
              expect(item).to.have.all.keys(['_state', '_progress', '_state_changed', '_error_details']);
              expect(item['_state']).to.equal('error');
              expect(item['_state_changed']).to.be.closeTo(new Date().getTime(), 250);
              expect(item['_progress']).to.equal(0);
              expect(item['_error_details']).to.have.all.keys(['previousState', 'error']);
              expect(item['_error_details'].previousState).to.equal(th.validBasicJobSpec.inProgressState);
              expect(item['_error_details'].error).to.equal(error);
              done();
            } catch (error) {
              done(error);
            }
          }
        });
      });
    });

    it('should not reject an item that no longer exists', function(done) {
      testRef = queueRef.push();

      var CallbackQueueWorker = function() {
        th.QueueWorker.apply(this, arguments);
      };
      util.inherits(CallbackQueueWorker, th.QueueWorker);
      CallbackQueueWorker.prototype._setUpTimeouts = _.noop;
      CallbackQueueWorker.prototype._tryToProcess = function() {
        testRef.once('value', function(snapshot) {
          try {
            expect(snapshot.val()).to.be.null;
            done();
          } catch (error) {
            done(error);
          }
        });
      };
      qw = new CallbackQueueWorker(queueRef, '0', _.noop);

      qw.setJob(th.validJobSpecWithFinishedState);
      qw.currentItemRef = testRef;
      qw._reject();
    });

    it('should not reject an item if it is no longer owned by the current worker', function(done) {
      testRef = queueRef.push();
      var originalItem = {
        '_state': th.validJobSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': 'other_worker',
        '_progress': 0
      };

      var CallbackQueueWorker = function() {
        th.QueueWorker.apply(this, arguments);
      };
      util.inherits(CallbackQueueWorker, th.QueueWorker);
      CallbackQueueWorker.prototype._setUpTimeouts = _.noop;
      CallbackQueueWorker.prototype._tryToProcess = function() {
        testRef.once('value', function(snapshot) {
          try {
            expect(snapshot.val()).to.deep.equal(originalItem);
            done();
          } catch (error) {
            done(error);
          }
        });
      };

      qw = new CallbackQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validJobSpecWithFinishedState);
      testRef.set(originalItem, function() {
        qw.currentItemRef = testRef;
        qw._reject();
      });
    });

    it('should not reject an item if it is has already changed state', function(done) {
      testRef = queueRef.push();

      var CallbackQueueWorker = function() {
        th.QueueWorker.apply(this, arguments);
      };
      util.inherits(CallbackQueueWorker, th.QueueWorker);
      CallbackQueueWorker.prototype._setUpTimeouts = _.noop;
      var first = true;
      CallbackQueueWorker.prototype._tryToProcess = function() {
        if (first) {
          first = false;
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
              done();
            } catch (error) {
              done(error);
            }
          });
        }
      };

      qw = new CallbackQueueWorker(queueRef, '0', _.noop);
      var originalItem = {
        '_state': th.validJobSpecWithFinishedState.finishedState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.uuid,
        '_progress': 0
      };
      qw.setJob(th.validJobSpecWithFinishedState);
      testRef.set(originalItem, function() {
        qw.currentItemRef = testRef;
        qw._reject();
      });
    });

    it('should not reject an item if it is has no state', function(done) {
      testRef = queueRef.push();

      var CallbackQueueWorker = function() {
        th.QueueWorker.apply(this, arguments);
      };
      util.inherits(CallbackQueueWorker, th.QueueWorker);
      CallbackQueueWorker.prototype._setUpTimeouts = _.noop;
      var first = true;
      CallbackQueueWorker.prototype._tryToProcess = function() {
        if (first) {
          first = false;
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
              done();
            } catch (error) {
              done(error);
            }
          });
        }
      };

      qw = new CallbackQueueWorker(queueRef, '0', _.noop);
      var originalItem = {
        '_state_changed': new Date().getTime(),
        '_owner': qw.uuid,
        '_progress': 0
      };
      qw.setJob(th.validJobSpecWithFinishedState);
      testRef.set(originalItem, function() {
        qw.currentItemRef = testRef;
        qw._reject();
      });
    });

    it('should not reject an item if it is no longer being processed', function(done) {
      testRef = queueRef.push();

      var CallbackQueueWorker = function() {
        th.QueueWorker.apply(this, arguments);
      };
      util.inherits(CallbackQueueWorker, th.QueueWorker);
      CallbackQueueWorker.prototype._setUpTimeouts = _.noop;
      var first = true;
      CallbackQueueWorker.prototype._tryToProcess = function() {
        if (first) {
          first = false;
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
              done();
            } catch (error) {
              done(error);
            }
          });
        }
      };

      qw = new CallbackQueueWorker(queueRef, '0', _.noop);
      var originalItem = {
        '_state': th.validJobSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.uuid,
        '_progress': 0
      };
      qw.setJob(th.validJobSpecWithFinishedState);
      testRef.set(originalItem, function() {
        qw._reject();
      });
    });
  });

  describe('#_updateProgress', function() {
    var qw;

    ['', 'foo', NaN, Infinity, true, false, -1, 100.1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidPercentageValue) {
      it('should ignore invalid input ' + invalidPercentageValue + ' to update the progress', function() {
        qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
        qw.currentItemRef = queueRef.push();
        return qw._updateProgress(invalidPercentageValue).should.eventually.be.rejectedWith('Invalid progress');
      });
    });

    it('should not update the progress of an item no longer owned by the current worker', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      qw.currentItemRef = queueRef.push({ '_state': th.validBasicJobSpec.inProgressState, '_owner': 'someone_else' }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(10).should.eventually.be.rejectedWith('Current item no longer owned by this process').notify(done);
      });
    });

    it('should not update the progress of an item if the worker is no longer processing it', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      queueRef.push({ '_state': th.validBasicJobSpec.inProgressState, '_owner': qw.uuid }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(10).should.eventually.be.rejectedWith('No item currently being processed').notify(done);
      });
    });

    it('should not update the progress of an item if the item is no longer in progress', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validJobSpecWithFinishedState);
      qw.currentItemRef = queueRef.push({ '_state': th.validJobSpecWithFinishedState.finishedState, '_owner': qw.uuid }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(10).should.eventually.be.rejectedWith('Current item no longer owned by this process').notify(done);
      });
    });

    it('should not update the progress of an item if the item has no _state', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      qw.currentItemRef = queueRef.push({ '_owner': qw.uuid }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(10).should.eventually.be.rejectedWith('Current item no longer owned by this process').notify(done);
      });
    });

    it('should update the progress of the current item', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      qw.currentItemRef = queueRef.push({ '_state': th.validBasicJobSpec.inProgressState, '_owner': qw.uuid }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(10).should.eventually.be.fulfilled.notify(done);
      });
    });
  });

  xdescribe('#_tryToProcess', _.noop);

  xdescribe('#_setUpTimeouts', _.noop);

  describe('#_isValidJobSpec', function() {
    var qw;

    before(function() {
      qw = new th.QueueWorker(queueRef, '0', _.noop);
    });

    it('should not accept a non-plain object as a valid job spec', function() {
      ['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], null, _.noop].forEach(function(nonPlainObject) {
        expect(qw._isValidJobSpec(nonPlainObject)).to.be.false;
      });
    });

    it('should not accept an empty object as a valid job spec', function() {
      expect(qw._isValidJobSpec({})).to.be.false;
    });

    it('should not accept a non-empty object without the required keys as a valid job spec', function() {
      expect(qw._isValidJobSpec({ foo: 'bar' })).to.be.false;
    });

    it('should not accept a startState that is not a string as a valid job spec', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        var jobSpec = _.clone(th.validBasicJobSpec);
        jobSpec.startState = nonStringObject;
        expect(qw._isValidJobSpec(jobSpec)).to.be.false;
      });
    });

    it('should not accept an inProgressState that is not a string as a valid job spec', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        var jobSpec = _.clone(th.validBasicJobSpec);
        jobSpec.inProgressState = nonStringObject;
        expect(qw._isValidJobSpec(jobSpec)).to.be.false;
      });
    });

    it('should not accept a finishedState that is not a string as a valid job spec', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        var jobSpec = _.clone(th.validBasicJobSpec);
        jobSpec.finishedState = nonStringObject;
        expect(qw._isValidJobSpec(jobSpec)).to.be.false;
      });
    });

    it('should not accept a timeout that is not a positive integer as a valid job spec', function() {
      ['', 'foo', NaN, Infinity, true, false, 0, -1, 1.1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonPositiveIntigerObject) {
        var jobSpec = _.clone(th.validBasicJobSpec);
        jobSpec.jobTimeout = nonPositiveIntigerObject;
        expect(qw._isValidJobSpec(jobSpec)).to.be.false;
      });
    });

    it('should accept a valid job spec without a timeout', function() {
      expect(qw._isValidJobSpec(th.validBasicJobSpec)).to.be.true;
    });

    it('should accept a valid job spec with a startState', function() {
      expect(qw._isValidJobSpec(th.validJobSpecWithStartState)).to.be.true;
    });

    it('should not accept a jobSpec with the same startState and inProgressState', function() {
      var jobSpec = _.clone(th.validBasicJobSpec);
      jobSpec.startState = jobSpec.inProgressState;
      expect(qw._isValidJobSpec(jobSpec)).to.be.false;
    });

    it('should accept a valid job spec with a finishedState', function() {
      expect(qw._isValidJobSpec(th.validJobSpecWithFinishedState)).to.be.true;
    });

    it('should not accept a jobSpec with the same finishedState and inProgressState', function() {
      var jobSpec = _.clone(th.validBasicJobSpec);
      jobSpec.finishedState = jobSpec.inProgressState;
      expect(qw._isValidJobSpec(jobSpec)).to.be.false;
    });

    it('should accept a valid job spec with a timeout', function() {
      expect(qw._isValidJobSpec(th.validJobSpecWithTimeout)).to.be.true;
    });

    it('should accept a valid job spec with a startState and a timeout', function() {
      expect(qw._isValidJobSpec(th.validJobSpecWithStartStateAndTimeout)).to.be.true;
    });

    it('should accept a valid job spec with a startState and a finishedState', function() {
      expect(qw._isValidJobSpec(th.validJobSpecWithStartStateAndFinishedState)).to.be.true;
    });

    it('should not accept a jobSpec with the same startState and finishedState', function() {
      var jobSpec = _.clone(th.validJobSpecWithFinishedState);
      jobSpec.startState = jobSpec.finishedState;
      expect(qw._isValidJobSpec(jobSpec)).to.be.false;
    });

    it('should accept a valid job spec with a finishedState and a timeout', function() {
      expect(qw._isValidJobSpec(th.validJobSpecWithFinishedStateAndTimeout)).to.be.true;
    });

    it('should accept a valid job spec with a startState, a finishedState, and a timeout', function() {
      expect(qw._isValidJobSpec(th.validJobSpecWithEverything)).to.be.true;
    });

    it('should accept a valid basic job spec with null parameters for everything else', function() {
      var jobSpec = _.clone(th.validBasicJobSpec);
      jobSpec = _.assign(jobSpec, {
        startState: null,
        finishedState: null,
        jobTimeout: null
      });
      expect(qw._isValidJobSpec(jobSpec)).to.be.true;
    });

  });

  describe('#setJob', function() {
    var qw;

    afterEach(function(done) {
      qw.setJob();
      queueRef.set(null, done);
    });

    it('should reset the worker when called with an invalid job spec', function() {
      ['', 'foo', NaN, Infinity, true, false, null, undefined, 0, -1, 10, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidJobSpec) {
        qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
        var oldUUID = qw.uuid;
        qw.setJob(invalidJobSpec);
        expect(qw.uuid).to.not.equal(oldUUID);
        expect(qw.startState).to.be.null;
        expect(qw.inProgressState).to.be.null;
        expect(qw.finishedState).to.be.null;
        expect(qw.jobTimeout).to.be.null;
        expect(qw.newItemRef).to.be.null;
        expect(qw.newItemListener).to.be.null;
        expect(qw.expiryTimeouts).to.deep.equal({});
      });
    });

    it('should reset the worker when called with an invalid job spec after a valid job spec', function() {
      ['', 'foo', NaN, Infinity, true, false, null, undefined, 0, -1, 10, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidJobSpec) {
        qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
        qw.setJob(th.validBasicJobSpec);
        var oldUUID = qw.uuid;
        qw.setJob(invalidJobSpec);
        expect(qw.uuid).to.not.equal(oldUUID);
        expect(qw.startState).to.be.null;
        expect(qw.inProgressState).to.be.null;
        expect(qw.finishedState).to.be.null;
        expect(qw.jobTimeout).to.be.null;
        expect(qw.newItemRef).to.be.null;
        expect(qw.newItemListener).to.be.null;
        expect(qw.expiryTimeouts).to.deep.equal({});
      });
    });

    it('should reset the worker when called with an invalid job spec after a valid job spec with everythin', function() {
      ['', 'foo', NaN, Infinity, true, false, null, undefined, 0, -1, 10, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidJobSpec) {
        qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
        qw.setJob(th.validJobSpecWithEverything);
        var oldUUID = qw.uuid;
        qw.setJob(invalidJobSpec);
        expect(qw.uuid).to.not.equal(oldUUID);
        expect(qw.startState).to.be.null;
        expect(qw.inProgressState).to.be.null;
        expect(qw.finishedState).to.be.null;
        expect(qw.jobTimeout).to.be.null;
        expect(qw.newItemRef).to.be.null;
        expect(qw.newItemListener).to.be.null;
        expect(qw.expiryTimeouts).to.deep.equal({});
      });
    });

    it('should reset a worker when called with a basic valid job spec', function() {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      var oldUUID = qw.uuid;
      qw.setJob(th.validBasicJobSpec);
      expect(qw.uuid).to.not.equal(oldUUID);
      expect(qw.startState).to.be.null;
      expect(qw.inProgressState).to.equal(th.validBasicJobSpec.inProgressState);
      expect(qw.finishedState).to.be.null;
      expect(qw.jobTimeout).to.be.null;
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid job spec with a startState', function() {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      var oldUUID = qw.uuid;
      qw.setJob(th.validJobSpecWithStartState);
      expect(qw.uuid).to.not.equal(oldUUID);
      expect(qw.startState).to.equal(th.validJobSpecWithStartState.startState);
      expect(qw.inProgressState).to.equal(th.validJobSpecWithStartState.inProgressState);
      expect(qw.finishedState).to.be.null;
      expect(qw.jobTimeout).to.be.null;
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid job spec with a finishedState', function() {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      var oldUUID = qw.uuid;
      qw.setJob(th.validJobSpecWithFinishedState);
      expect(qw.uuid).to.not.equal(oldUUID);
      expect(qw.startState).to.be.null;
      expect(qw.inProgressState).to.equal(th.validJobSpecWithFinishedState.inProgressState);
      expect(qw.finishedState).to.equal(th.validJobSpecWithFinishedState.finishedState);
      expect(qw.jobTimeout).to.be.null;
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid job spec with a timeout', function() {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      var oldUUID = qw.uuid;
      qw.setJob(th.validJobSpecWithTimeout);
      expect(qw.uuid).to.not.equal(oldUUID);
      expect(qw.startState).to.be.null;
      expect(qw.inProgressState).to.equal(th.validJobSpecWithTimeout.inProgressState);
      expect(qw.finishedState).to.be.null;
      expect(qw.jobTimeout).to.equal(th.validJobSpecWithTimeout.jobTimeout);
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid job spec with a startState and a finishedState', function() {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      var oldUUID = qw.uuid;
      qw.setJob(th.validJobSpecWithStartStateAndFinishedState);
      expect(qw.uuid).to.not.equal(oldUUID);
      expect(qw.startState).to.equal(th.validJobSpecWithStartStateAndFinishedState.startState);
      expect(qw.inProgressState).to.equal(th.validJobSpecWithStartStateAndFinishedState.inProgressState);
      expect(qw.finishedState).to.equal(th.validJobSpecWithStartStateAndFinishedState.finishedState);
      expect(qw.jobTimeout).to.be.null;
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid job spec with a startState and a timeout', function() {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      var oldUUID = qw.uuid;
      qw.setJob(th.validJobSpecWithStartStateAndTimeout);
      expect(qw.uuid).to.not.equal(oldUUID);
      expect(qw.startState).to.equal(th.validJobSpecWithStartStateAndTimeout.startState);
      expect(qw.inProgressState).to.equal(th.validJobSpecWithStartStateAndTimeout.inProgressState);
      expect(qw.finishedState).to.be.null;
      expect(qw.jobTimeout).to.equal(th.validJobSpecWithStartStateAndTimeout.jobTimeout);
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid job spec with a finishedState and a timeout', function() {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      var oldUUID = qw.uuid;
      qw.setJob(th.validJobSpecWithFinishedStateAndTimeout);
      expect(qw.uuid).to.not.equal(oldUUID);
      expect(qw.startState).to.be.null;
      expect(qw.inProgressState).to.equal(th.validJobSpecWithFinishedStateAndTimeout.inProgressState);
      expect(qw.finishedState).to.equal(th.validJobSpecWithFinishedStateAndTimeout.finishedState);
      expect(qw.jobTimeout).to.equal(th.validJobSpecWithFinishedStateAndTimeout.jobTimeout);
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid job spec with everything', function() {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      var oldUUID = qw.uuid;
      qw.setJob(th.validJobSpecWithEverything);
      expect(qw.uuid).to.not.equal(oldUUID);
      expect(qw.startState).to.equal(th.validJobSpecWithEverything.startState);
      expect(qw.inProgressState).to.equal(th.validJobSpecWithEverything.inProgressState);
      expect(qw.finishedState).to.equal(th.validJobSpecWithEverything.finishedState);
      expect(qw.jobTimeout).to.equal(th.validJobSpecWithEverything.jobTimeout);
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should not pick up items on the queue not for the current item', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      var spy = sinon.spy(qw, '_tryToProcess');
      queueRef.once('child_added', function() {
        try {
          expect(qw._tryToProcess).to.not.have.been.called;
          spy.restore();
          done();
        } catch (error) {
          spy.restore();
          done(error);
        }
      });
      queueRef.push({ '_state': 'other' });
    });

    it('should pick up items on the queue with no "_state" when a job is specified without a startState', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      var spy = sinon.spy(qw, '_tryToProcess');
      var ref = queueRef.push();
      queueRef.once('child_added', function() {
        try {
          expect(qw._tryToProcess).to.have.been.calledOnce.and.calledWith(ref);
          spy.restore();
          done();
        } catch (error) {
          spy.restore();
          done(error);
        }
      });
      ref.set({ 'foo': 'bar' });
    });

    it('should pick up items on the queue with the corresponding "_state" when a job is specifies a startState', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validJobSpecWithStartState);
      var spy = sinon.spy(qw, '_tryToProcess');
      var ref = queueRef.push();
      queueRef.once('child_added', function() {
        try {
          expect(qw._tryToProcess).to.have.been.calledOnce.and.calledWith(ref);
          spy.restore();
          done();
        } catch (error) {
          spy.restore();
          done(error);
        }
      });
      ref.set({ '_state': th.validJobSpecWithStartState.startState });
    });
  });
});
