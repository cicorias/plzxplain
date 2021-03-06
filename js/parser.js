(function(plzxplain, esprima) {
  "use strict";
  // this parser will take the javascript AST from esprima
  // and then convert it into the info needed to draw a flowchart
  // right now it's assumed that a flow chart has the following elements
  // statement - rectangle (SET VARIABLE, DECLARE VARIABLE, DECLARE SUBROUTINE)
  // question - diamond (YES/NO)
  // subroutine - rectangle (DECLARE SUBROUTINE) and then show the block for it
  // subroutinecall - rectangle with an extra vertical line each side
  //
  // this may not properly reflect everything that can be done with javascript
  // but that's not the idea of this project - simple explainations are best
  //
  // We're going to use flowchart.js to render the flowchart
  // it requires that we create a list of symbols and then create
  // a set of flows that link the symbols together
  //
  // For this to work we need an array of flowcharts. The item at index zero
  // would be the main program and then every item after that would be a
  // subroutine.
  //
  /* example resulting object
  [{
    name: "Program",
    symbols: [{
      type: 'operation',
      id: 'op1',
      text: 'Declare variable `i`',
      loc: { ... }
    },{
      type: 'operation',
      id: 'op2',
      text: 'Set variable `i` to be 1',
      loc: { ... }
    }],
    sequences: [['op1', 'op2']]
  }]
  */

  var parsedResult = [];
  var statementCounter = 1;
  var anonFuncCounter = 1;
  var nodeParsers = { };
  var binaryoperators = {
    "==": "IS EQUAL TO",
    "===": "IS EXACTLY EQUAL TO",
    "<": "IS LESS THAN",
    ">": "IS GREATER THAN",
    "<=": "IS LESS THAN OR EQUAL TO",
    ">=": "IS GREATER THAN OR EQUAL TO"
  };

  function makeSymbol(type, text, loc) {
    return {
      id: 'op' + (statementCounter++),
      type: type,
      text: text,
      loc: loc || null
    };
  }
  function makeOperation(text, loc) {
    return makeSymbol('operation', text, loc);
  }
  function makeSubroutine(text, loc) {
    return makeSymbol('subroutine', text, loc);
  }
  function makeCondition(text, loc){
    return makeSymbol('condition', text, loc);
  }
  function blankResult() {
    return {
      symbols: [],
      sequences: [],
      firstStep: null,
      lastStep: null,
      conditionStep: null
    };
  }
  function isStringOrNum(val) {
    var valtype = typeof(val);
    return (valtype === 'string' || valtype === 'number');
  }
  function flattenedValue(val) {
    if(isStringOrNum(val)) {
      return val;
    } else if(!val.text) {
      return '(' + val.symbols[0].text + ')';
    } else {
      return '(' + val.text + ')';
    }
  }
  function parseNode(node, asCondition) {
    if(!nodeParsers[node.type]) {
      throw new Error("Parser not implemented for node type " + node.type);
    }
    return nodeParsers[node.type](node, asCondition);
  }
  function pushSequence(sequenceArr, currentStep, val) {
    var i, ii;
    if(!currentStep) {
      return;
    }
    if(currentStep.constructor === Array) {
      for(i=0, ii=currentStep.length; i<ii; i++) {
        pushSequence(sequenceArr, currentStep[i], val);
      }
      return;
    }
    if(val.constructor === Array) {
      for(i=0, ii=val.length; i<ii; i++) {
        pushSequence(sequenceArr, currentStep, val[i]);
      }
      return;
    }
    if(currentStep.type === 'condition') {
      if(currentStep.yes) {
        if(currentStep.no) {
          sequenceArr.push([currentStep.id + "(then)", val.id]);
          currentStep.then = true;
        } else {
          sequenceArr.push([currentStep.id + "(no)", val.id]);
          currentStep.no = true;
        }
      } else {
        sequenceArr.push([currentStep.id + "(yes)", val.id]);
        currentStep.yes = true;
      }
    } else {
      sequenceArr.push([currentStep.id, val.id]);
    }
  }
  function mergeResult(symbolsArr, sequenceArr, currentStep, val) {
    if(val.id) {
      symbolsArr.push(val);
      if(currentStep) {
        pushSequence(sequenceArr, currentStep, val);
      }
      currentStep = val;
    } else {
      // lots of steps and sequences
      for(var i=0, ii=val.symbols.length; i<ii; i++) {
        symbolsArr.push(val.symbols[i]);
      }
      if(currentStep) {
        pushSequence(sequenceArr, currentStep, val.firstStep);
      }
      for(var j=0, jj=val.sequences.length; j<jj; j++) {
        sequenceArr.push(val.sequences[j]);
      }
      currentStep = val.lastStep;
    }
    return currentStep;
  }
  function parseBlock(symbolsArr, sequenceArr, currentStep, block) {
    var i, ii, firstStep;
    firstStep = currentStep;
    for(i=0, ii=block.length; i<ii; i++) {
      var node = block[i];
      if(nodeParsers[node.type]) {
        var val = parseNode(node);
        if(isStringOrNum(val)) {
          val = makeOperation(val, node.loc);
        }
        currentStep = mergeResult(symbolsArr, sequenceArr, currentStep, val);
      } else {
        var step = makeOperation('Error parsing unknown node type - ' + node.type);
        symbolsArr.push(step);
        pushSequence(sequenceArr, currentStep, step);
        currentStep = step;
      }
      if(!firstStep) {
        firstStep = currentStep;
      }
    }
    return {
      symbols: symbolsArr,
      sequences: sequenceArr,
      firstStep: currentStep,
      lastStep: currentStep
    };
  }
  function parseTest(test) {
    var result = {
      symbols: [],
      sequences: [],
      firstStep: null,
      lastStep: null,
      conditionStep: null
    };
    var testVal = parseNode(test, true);
    if(isStringOrNum(testVal)) {
      var cond = makeCondition(testVal, test.loc);
      result.symbols.push(cond);
      result.lastStep = cond;
      result.firstStep = cond;
      result.conditionStep = cond;
    } else {
      result.lastStep = mergeResult(result.symbols, result.sequences, null, testVal);
      result.firstStep = result.symbols[0];
      result.conditionStep = result.lastStep;
    }
    return result;
  }
  function parseRoutine(name, body) {
    var program = { name: name, symbols: [], sequences: [] };
    parsedResult.push(program);
    var start = {
      type: 'start',
      id: 'start_' + name,
      text: 'Start ' + name
    };
    program.symbols.push(start);
    var currentStep = start;
    var result = parseBlock(program.symbols, program.sequences, currentStep, body);
    var end = {
      type: 'end',
      id: 'end_' + name,
      text: 'End ' + name
    };
    program.symbols.push(end);
    pushSequence(program.sequences, result.lastStep, end);
  }
  nodeParsers.Program = function(tree) {
    parseRoutine('Program', tree.body);
  };
  nodeParsers.Identifier = function(node) {
    return "`" + node.name + "`";
  };
  nodeParsers.Literal = function(node) {
    if(typeof node.value === 'boolean') {
      return node.value ? 'TRUE' : 'FALSE';
    } else if(node.value === null) {
      return 'NULL';
    } else if(isFinite(node.value)) {
      var val = parseFloat(node.value);
      if(isNaN(val)) {
        return node.value;
      }
      return val;
    }
    return "'" + node.value + "'";
  };
  nodeParsers.VariableDeclaration = function(node) {
    var symbols = [];
    var sequences = [];
    var currentStep;
    var firstStep;
    var dec = node.declarations;
    for(var i=0, ii=dec.length;i<ii;i++) {
      var d = dec[i];
      if(d.type === "VariableDeclarator") {
        var declareStep = makeOperation("DECLARE VARIABLE " + parseNode(d.id), d.id.loc);
        symbols.push(declareStep);
        if(currentStep) {
          sequences.push([currentStep.id, declareStep.id]);
        } else {
          firstStep = declareStep;
        }
        currentStep = declareStep;
        if(d.init) {
          var initVal = parseNode(d.init);
          var action = "SET " + parseNode(d.id) + " = ";
          if(isStringOrNum(initVal)) {
            action += initVal;
          } else {
            action += '(' + initVal.text + ')';
          }
          var initStep = makeOperation(action, node.loc);
          symbols.push(initStep);
          sequences.push([currentStep.id, initStep.id]);
          currentStep = initStep;
        }
      } else {
        console.error("Unknown variable declaration: " + JSON.stringify(node));
      }
    }
    return {
      symbols: symbols,
      sequences: sequences,
      firstStep: firstStep,
      lastStep: currentStep
    };
  };
  nodeParsers.ArrayExpression = function(node) {
    var result;
    if(node.elements.length === 0) {
      result = 'EMPTY ARRAY';
    } else {
      result = 'ARRAY CONTAINING \\\n';
      var items = [];
      for(var i=0, ii=node.elements.length; i<ii; i++) {
        var val = parseNode(node.elements[i]);
        items.push(val);
      }
      result += items.join(', \\\n');
    }
    return result;
  };
  nodeParsers.FunctionDeclaration = function(node) {
    var subroutineName = parseNode(node.id);
    var action = "DECLARE SUBROUTINE " + subroutineName;
    if(node.params.length) {
      action += "\\\nWITH " + node.params.length + " PARAMETERS";
    }
    parseRoutine(subroutineName, node.body.body);
    return makeOperation(action, node.loc);
  };
  nodeParsers.FunctionExpression = function(node) {
    var subroutineName;
    if(node.id){
      subroutineName = parseNode(node.id);
    } else {
      subroutineName = 'AnonymousFunction' + (anonFuncCounter++);
    }
    var action = "DECLARE SUBROUTINE " + subroutineName;
    if(node.params.length) {
      action += "\\\nWITH " + node.params.length + " PARAMETERS";
    }
    parseRoutine(subroutineName, node.body.body);
    return makeOperation(action, node.loc);
  };
  nodeParsers.BlockStatement = function(node) {
    return parseBlock([], [], null, node.body);
  };
  nodeParsers.SequenceExpression = function(node) {
    return parseBlock([], [], null, node.expressions);
  };
  nodeParsers.ExpressionStatement = function(node) {
    return parseNode(node.expression);
  };
  nodeParsers.DebuggerStatement = function(node) {
    return makeSubroutine("Pause code execution when debugging", node.loc);
  };
  nodeParsers.CallExpression = function(node) {
    var calleeVal = parseNode(node.callee);
    var action = "CALL SUBROUTINE ";
    if(isStringOrNum(calleeVal)) {
      action += calleeVal;
    } else {
      action += calleeVal.text;
    }
    var args = node['arguments'];
    if(args.length) {
      action += " WITH ";
      var argList = [];
      for(var i=0, ii=args.length; i<ii; i++) {
        var arg = args[i];
        argList.push(flattenedValue(parseNode(arg)));
      }
      action += argList.join(", ");
    }
    return makeSubroutine(action, node.loc);
  };
  nodeParsers.NewExpression = function(node) {
    var calleeVal = parseNode(node.callee);
    return makeSubroutine("NEW OBJECT OF TYPE " + calleeVal, node.loc);
  };
  nodeParsers.MemberExpression = function(node) {
    var left, right;
    var objVal = parseNode(node.object);
    if(isStringOrNum(objVal)){
      left = objVal;
    } else {
      left = '(' + objVal.text + ')';
    }
    right = parseNode(node.property);
    return left + '.' + right;
  }
  // a + b, a - b, a == b, a * b, a / b
  /*
  "==" | "!=" | "===" | "!=="
           | "<" | "<=" | ">" | ">="
           | "<<" | ">>" | ">>>"
           | "+" | "-" | "*" | "/" | "%"
           | "|" | "^" | "in"
           | "instanceof" | ".."
  */
  nodeParsers.BinaryExpression = function(node, asCondition) {
    var result = blankResult();
    var left, right, operator, symbol;

    left = flattenedValue(parseNode(node.left));
    right = flattenedValue(parseNode(node.right));

    operator = binaryoperators[node.operator] || node.operator;
    var action = left + " " + operator + " " + right;
    symbol = asCondition ? makeCondition(action, node.loc) : makeOperation(action, node.loc);
    result.symbols.push(symbol);
    if(result.lastStep) {
      result.sequences.push([result.lastStep.id, symbol.id]);
    }
    result.firstStep = result.symbols[0];
    result.lastStep = symbol;

    return result;
  };
  nodeParsers.ObjectExpression = function(node) {
    var result = "OBJECT CONTAINING ";
    if(node.properties.length === 0) {
      result += 'NOTHING';
    } else {
      result += '\\\n';
      var vals = [];
      for(var i=0, ii=node.properties.length; i<ii; i++) {
        var property = node.properties[i];
        if(property.type !== 'Property') {
          throw new Error("ObjectExpression property is not of type Property");
        }
        vals.push(parseNode(property.key) + ' \u00BB ' + parseNode(property.value));
      }
      result += vals.join(',\\\n');
    }
    return result;
  };
  nodeParsers.UnaryExpression = function(node) {
    var test = parseNode(node.argument);
    if(node.prefix) {
      // if it's a math operator then do something different
      if(node.operator === '-' || node.operator === '+') {
        return '(' + node.operator + test + ')';
      }
    }
    var truthyness = node.operator === '!' ? 'IS NOT TRUTHY' : 'IS TRUTHY';
    return  test + " " + truthyness;
  };
  nodeParsers.AssignmentExpression = function(node) {
    var action;
    var left = parseNode(node.left);
    var right = flattenedValue(parseNode(node.right));
    if(node.operator === '=') {
      action = "SET " + left + " = " + right;
    } else {
      var operator = node.operator.substr(0, node.operator.length - 1);
      action = "SET " + left + " = " + left + " " + operator + " " + right;
    }
    return makeOperation(action, node.loc);
  };
  nodeParsers.WhileStatement = function(node) {
    var result = parseTest(node.test);

    var firstTestStep = result.firstStep;
    var conditionStep = result.conditionStep;
    var testLen = result.symbols.length;

    var bodyVal = parseNode(node.body);
    var finalBodyStep = mergeResult(result.symbols, result.sequences, null, bodyVal);
    var firstBodyStep = result.symbols[testLen];
    result.sequences.push([finalBodyStep.id, firstTestStep.id]);
    result.sequences.push([conditionStep.id + '(yes)', firstBodyStep.id]);
    conditionStep.yes = true;
    result.lastStep = conditionStep;
    return result;
  };
  nodeParsers.ForStatement = function(node) {
    // init -> test -> update -> body -> test
    var result = parseNode(node.init);
    var test = parseTest(node.test);
    result.lastStep = mergeResult(result.symbols, result.sequences, result.lastStep, test);
    var bodyValue = parseNode(node.body);
    result.lastStep = mergeResult(result.symbols, result.sequences, result.lastStep, bodyValue);
    pushSequence(result.sequences, result.lastStep, test.lastStep);
    result.lastStep = test.lastStep;
    return result;
  };
  nodeParsers.ForInStatement = function(node) {
    var left, right;
    var result = blankResult();

    if(node.left.type === 'VariableDeclaration') {
      var leftVal = parseNode(node.left);
      result.lastStep = mergeResult(result.symbols, result.sequences, result.lastStep, leftVal);
      left = parseNode(node.left.declarations[0].id);
    } else {
      left = parseNode(node.left);
    }
    right = flattenedValue(parseNode(node.right));

    var cond = makeCondition(right + ' HAS MORE KEYS', node.right.loc);
    result.symbols.push(cond);
    if(result.lastStep) {
      pushSequence(result.sequences, result.lastStep, cond);
    }


    var actionStep = makeOperation('SET ' + left + ' = NEXT KEY IN ' + right, node.left);
    result.symbols.push(actionStep);
    pushSequence(result.sequences, cond, actionStep);
    result.lastStep = actionStep;

    var bodyVal = parseNode(node.body);
    if(isStringOrNum(bodyVal)) {
      bodyVal = makeOperation(bodyVal, node.body.loc);
    } else if(bodyVal.symbols.length === 0) {
      bodyVal = makeOperation('DO NOTHING', node.body.loc);
    }
    result.lastStep = mergeResult(result.symbols, result.sequences, result.lastStep, bodyVal);
    pushSequence(result.sequences, bodyVal.lastStep ? bodyVal.lastStep : bodyVal, cond);
    result.lastStep = cond;
    result.conditionStep = cond;
    result.firstStep = result.symbols[0];
    return result;
  };
  nodeParsers.UpdateExpression = function(node) {
    var obj = parseNode(node.argument);
    var action = "SET " + obj + " = ";
    if(node.operator === "++") {
      action += obj +" + 1";
    }else if(node.operator === "--") {
      action += obj +" - 1";
    }
    return makeOperation(action, node.loc);
  };
  nodeParsers.IfStatement = function(node) {
    var result = parseTest(node.test);
    var len = result.symbols.length;
    var finalSteps = [result.conditionStep];
    // yes
    var yesVal = parseNode(node.consequent);
    if(isStringOrNum(yesVal)) {
      yesVal = makeOperation(yesVal, node.consequent.loc);
    }
    finalSteps.push(mergeResult(result.symbols, result.sequences, null, yesVal));

    result.sequences.push([result.conditionStep.id + '(yes)', result.symbols[len].id]);
    result.conditionStep.yes = true;
    len = result.symbols.length;

    // no
    if(node.alternate) {
      var noVal = parseNode(node.alternate);
      if(isStringOrNum(noVal)) {
        noVal = makeOperation(noVal, node.alternate.loc);
      }
      finalSteps.push(mergeResult(result.symbols, result.sequences, null, noVal));
      result.sequences.push([result.conditionStep.id + '(no)', result.symbols[len].id]);
      result.conditionStep.no = true;
    }

    result.lastStep = finalSteps;

    return result;
  };
  nodeParsers.ConditionalExpression = nodeParsers.IfStatement;
  nodeParsers.SwitchStatement = function(node) {
    throw new Error("Sadly switch statements are not supported yet");
    console.log(JSON.stringify(node));
    var discriminant = parseNode(node.discriminant);
    var cases = [];
    for(var i=0, ii=node.cases.length; i<ii; i++) {
      var breaks = false;
      var caseNode = node.cases[i];
      var testVal = parseNode(caseNode.test);
      var cond = makeCondition( discriminant + ' EQUALS ' + testVal, caseNode.test.loc);
      var consequent = [];
      for(var j=0, jj=caseNode.consequent.length; j<jj; j++) {
        if(caseNode.consequent[j].type === 'BreakStatement') {
          breaks = true;
        } else {
          consequent.push(caseNode.consequent[j]);
        }
      }
      var caseVal = parseBlock([cond], [], cond, consequent);
      caseVal.firstStep = cond;
      caseVal.condition = cond;
      caseVal.breaks = breaks;
      cases.push(caseVal);
    }
    if(cases.length === 0) {
      return makeOperation("EMPTY CASE STATEMENT", node.loc);
    } else {
      var result = blankResult();
      result.firstStep = [];
      console.log(JSON.stringify(cases));
      for(var c=0, cc=cases.length; c<cc; c++) {
        var cv = cases[c];
        // if it's the first item or the previous case didn't break
        if( c === 0 || c>0 && !cases[c-1].breaks) {
          result.firstStep.push(cv.firstStep);
        }
        // if there are no more steps then the (no) should move on to the next
        // thing in the program
        result.lastStep = mergeResult(result.symbols, result.sequences, result.lastStep, cv);
      }
      return result;
    }
  };
  nodeParsers.LogicalExpression = function(node) {
    return 'VALUE OF ' + parseNode(node.left) + ' ' + node.operator + ' ' + parseNode(node.right);
  };
  nodeParsers.ReturnStatement = function(node) {
    if(node.argument) {
      var val = parseNode(node.argument);
      return 'RETURN ' + flattenedValue(val);
    }
    return 'RETURN';
  };
  nodeParsers.ThisExpression = function() {
    return 'this';
  };
  nodeParsers.ThrowStatement = function(node) {
    if(node.argument) {
      var val = parseNode(node.argument);
      return 'THROW ' + flattenedValue(val);
    }
    return 'THROW';
  };
  nodeParsers.EmptyStatement = function() {
    return 'DO NOTHING';
  };

  // will return an error or an array of converted items
  function parse(str) {
    var obj;
    try {
      obj = esprima.parse(str, { loc: true });
    } catch(e) {
      return e;
    }

    try{
      parsedResult = [];
      parseNode(obj);
      return parsedResult;
    } catch(e) {
      return e;
    }
  }

  plzxplain.parse = parse;
  plzxplain.parse.resetCounters = function() {
    statementCounter = 1;
    anonFuncCounter = 1;
  };
  plzxplain.parse.getParsers = function() { return nodeParsers; };

})(this.plzxplain, this.esprima);